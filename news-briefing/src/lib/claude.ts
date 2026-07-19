import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import { createHash } from "crypto";
import type {
  RawArticle,
  ScoredArticle,
  TokenUsage,
} from "./types";

const client = new Anthropic();

// Scoring/clustering always run on Haiku — internal ranking calls the user
// never reads. Only the summary model is user-configurable.
export const SCORING_MODEL = "claude-haiku-4-5";
export const SUMMARY_MODEL = "claude-haiku-4-5";

// $ per million tokens
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
};

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function costFor(model: string, usage: TokenUsage): number {
  const p = PRICING[model];
  if (!p) throw new Error(`No pricing entry for model "${model}". Add it to PRICING in claude.ts.`);
  const M = 1_000_000;
  return (
    (usage.input * p.input) / M +
    (usage.output * p.output) / M +
    (usage.cacheRead * p.input * 0.1) / M +
    (usage.cacheWrite * p.input * 1.25) / M
  );
}

function readUsage(res: Anthropic.Message): TokenUsage {
  return {
    input: res.usage.input_tokens ?? 0,
    output: res.usage.output_tokens ?? 0,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in model output");
  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

const SCORE_CLUSTER_SYSTEM = `You are a news curator. You will get a user's interests and a list of news article excerpts. Do both of the following, then return strict JSON only.

TASK 1 — score each article 0-10 for how well it matches any of the interests:
- 9-10: directly about a stated interest, high signal
- 6-8: meaningfully touches a stated interest
- 3-5: tangentially related
- 0-2: unrelated
If the interests list is empty, score every article 0.

TASK 2 — group the articles by underlying news event. Two articles belong in the same cluster only if they cover the same story (same event, same announcement, same actors, same day), even if the angles or framings differ. Do NOT merge articles that merely share a topic ("AI" or "the Fed"). Every article id must appear in exactly one cluster; singleton clusters are normal and expected.

Return JSON of the form:
{"scores":[{"id":<number>,"score":<0-10>,"interest":"<matched interest or empty string>"}],"clusters":[[<id>,<id>,...],[<id>],...]}`;

interface ScoreClusterResult {
  scores: { id: number; score: number; interest: string }[];
  clusters: number[][];
}

/**
 * One call does both relevance scoring and event clustering. The ~40-article
 * payload is the bulk of this stage's input tokens, so sending it once
 * instead of twice (the old separate scoring + clustering calls) roughly
 * halves the pre-summary input cost.
 *
 * On any failure (network, malformed output) falls back to the prefilter's
 * keyword-match ranking with singleton clusters, so the briefing still
 * builds instead of 500ing.
 */
export async function scoreAndCluster(
  candidates: { article: RawArticle; matchedInterest: string | null; score: number }[],
  interests: string[],
  model: string = SCORING_MODEL,
): Promise<{ articles: ScoredArticle[]; clusters: number[][]; usage: TokenUsage }> {
  if (candidates.length === 0) return { articles: [], clusters: [], usage: EMPTY_USAGE };

  const fallback = () => ({
    articles: candidates.map((c) => ({
      ...c.article,
      score: c.score,
      matchedInterest: c.matchedInterest,
    })),
    clusters: candidates.map((_, i) => [i]),
  });

  const indexed = candidates.map((c, i) => ({
    id: i,
    source: c.article.sourceName,
    title: c.article.title,
    excerpt: c.article.excerpt.slice(0, 280),
  }));

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model,
      max_tokens: 3000,
      system: [
        { type: "text", text: SCORE_CLUSTER_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: JSON.stringify({ interests, articles: indexed }) }],
    });
  } catch {
    return { ...fallback(), usage: EMPTY_USAGE };
  }

  const usage = readUsage(res);
  let parsed: ScoreClusterResult;
  try {
    parsed = parseJson<ScoreClusterResult>(textOf(res));
  } catch {
    return { ...fallback(), usage };
  }

  const byId = new Map((parsed.scores ?? []).map((s) => [s.id, s]));
  const articles = candidates.map((c, i) => {
    const s = byId.get(i);
    return {
      ...c.article,
      score: s?.score ?? 0,
      matchedInterest: s?.interest && s.interest.length > 0 ? s.interest : null,
    };
  });

  // Validate clusters: each id used at most once, in range; anything the
  // model dropped becomes its own singleton cluster.
  const seen = new Set<number>();
  const clusters: number[][] = [];
  for (const group of parsed.clusters ?? []) {
    if (!Array.isArray(group)) continue;
    const valid: number[] = [];
    for (const id of group) {
      if (!Number.isInteger(id) || id < 0 || id >= candidates.length || seen.has(id)) {
        continue;
      }
      seen.add(id);
      valid.push(id);
    }
    if (valid.length > 0) clusters.push(valid);
  }
  for (let i = 0; i < candidates.length; i++) {
    if (!seen.has(i)) clusters.push([i]);
  }

  return { articles, clusters, usage };
}

const SUMMARY_SYSTEM = `You are a senior news editor writing a daily briefing. Write a summary of the news article excerpt the user provides. The summary must:
- Open with the most newsworthy fact, not the source
- Explain why it matters to a reader interested in finance, markets, business, and policy
- Be self-contained (the reader will not click through unless intrigued)
- Use crisp, declarative sentences in active voice
- Avoid hype, hedging, and filler phrases like "in a recent development"

Use only the title and excerpt given — never ask for more information, never invent facts not present in them, and never comment on whether the input is sufficient. Write 6-8 sentences when the excerpt supports it; if the excerpt is thin (e.g. headline only, little detail), write 2-3 sentences that stay strictly to what's given rather than padding or speculating. A short accurate summary is always correct output; a refusal or request for more material is never correct output.

Return only the summary text itself — no headers, no preamble, no meta-commentary, no quotation marks.`;

// Defensive guard against the model replying conversationally (asking for
// more source material) instead of producing a summary. Scans only the
// opening portion — refusals declare themselves in the first sentence,
// and matching further in would risk flagging a legitimate summary that
// happens to use a word like "unable" mid-article. Treated as a failed
// call so it falls back to "Summary unavailable." rather than showing the
// refusal text to users.
const REFUSAL_PATTERN =
  /(i (can'?t|cannot|don'?t have|do not have|need)|i'?m unable|i am unable|unfortunately|please (provide|share|send)|you'?ve provided|you have provided|without (the |a )?(actual|substantive)|no actual article content|this (excerpt|article) (doesn'?t|does not|contains only))/i;

export function isRefusal(text: string): boolean {
  return REFUSAL_PATTERN.test(text.trim().slice(0, 200));
}

// Some feeds — Fed press/speech feeds especially — publish little or no
// body text beyond the headline. Asking the model to write a summary from
// essentially nothing reliably produces a refusal ("please provide the
// full article text...") ~25% of the time in practice, which is both a bad
// experience and a wasted call. Cheaper and more reliable to just not ask
// when there's nothing to summarize — this falls back to the same "Summary
// unavailable." treatment as any other failed call.
const MIN_EXCERPT_CHARS = 60;

async function summarizeOne(
  article: ScoredArticle,
  model: string,
): Promise<{ summary: string | null; usage: TokenUsage }> {
  if (article.excerpt.trim().length < MIN_EXCERPT_CHARS) {
    return { summary: null, usage: EMPTY_USAGE };
  }

  const res = await client.messages.create({
    model,
    max_tokens: 400,
    system: [
      { type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          source: article.sourceName,
          title: article.title,
          excerpt: article.excerpt.slice(0, 400),
        }),
      },
    ],
  });
  const text = textOf(res).trim();
  const usable = text.length > 0 && !isRefusal(text);
  return { summary: usable ? text : null, usage: readUsage(res) };
}

interface StoredSummary {
  summary: string | null;
  usage: TokenUsage;
  /** When the underlying API call actually ran — used to tell cache hits from fresh calls. */
  at: number;
}

// A summary depends only on the article and the model — not on interests,
// sort order, or the rest of the briefing — so it's cached per (article,
// model) for 2 days. Force-refreshes, interest tweaks, and next-day overlap
// all reuse summaries instead of re-paying the single most expensive stage.
const SUMMARY_CACHE_SECONDS = 60 * 60 * 48;

function cachedSummarizeOne(article: ScoredArticle, model: string): Promise<StoredSummary> {
  const linkKey = createHash("sha256")
    .update(article.link.split("?")[0].toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const fetcher = unstable_cache(
    async () => ({ ...(await summarizeOne(article, model)), at: Date.now() }),
    ["summary-v3", model, linkKey],
    { revalidate: SUMMARY_CACHE_SECONDS },
  );
  return fetcher();
}

/**
 * Summarize each article as its own cached call. Per-article granularity
 * (vs the old 4-article chunks) is what makes caching effective — a chunk's
 * membership changes between pulls, an article's link doesn't. It also means
 * one failed call degrades one card, and wall time is the latency of a
 * single short completion.
 */
export async function summarizeArticles(
  scored: ScoredArticle[],
  model: string = SUMMARY_MODEL,
): Promise<{ summaries: Map<number, string>; usage: TokenUsage }> {
  if (scored.length === 0) return { summaries: new Map(), usage: EMPTY_USAGE };

  const settled = await Promise.allSettled(
    scored.map((a) => cachedSummarizeOne(a, model)),
  );

  const merged = new Map<number, string>();
  let total: TokenUsage = EMPTY_USAGE;
  const now = Date.now();
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    if (r.value.summary) merged.set(i, r.value.summary);
    // Only count tokens actually spent on this pull: a stored `at` more than
    // a minute old means the value came from the data cache, not a fresh call.
    if (now - r.value.at < 60_000) total = addUsage(total, r.value.usage);
  });
  return { summaries: merged, usage: total };
}
