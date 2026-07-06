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

// Note on API-level prompt caching: our system prompts are ~300 tokens, far
// below Haiku 4.5's 4096-token minimum cacheable prefix, so `cache_control`
// markers would silently never cache (cacheRead stayed 0 for exactly this
// reason). Cost control here comes from compact output formats and the
// content-addressed Next.js data caches below instead.

// Output tokens cost 5x input, so the response format is deliberately terse:
// integer triples instead of labeled objects, interests referenced by index
// instead of repeating their text, and zero-score articles omitted entirely.
const SCORE_CLUSTER_SYSTEM = `You are a news curator. The user message is JSON with "interests" (list of {i, t} — index and text) and "articles" (list of {id, source, title, excerpt}). Do both of the following, then return strict JSON only.

TASK 1 — score each article 0-10 for how well it matches any of the interests:
- 9-10: directly about a stated interest, high signal
- 6-8: meaningfully touches a stated interest
- 3-5: tangentially related
- 0-2: unrelated
If the interests list is empty, score every article 0.

TASK 2 — group the articles by underlying news event. Two articles belong in the same cluster only if they cover the same story (same event, same announcement, same actors, same day), even if the angles or framings differ. Do NOT merge articles that merely share a topic ("AI" or "the Fed"). Every article id must appear in exactly one cluster; singleton clusters are normal and expected.

Return JSON of the form {"s":[[id,score,interest],...],"c":[[id,id,...],[id],...]}:
- "s": one [article id, score, index of the best-matching interest (-1 if none)] triple per article; omit articles that score 0
- "c": the clusters; every article id (including score-0 ones) appears in exactly one cluster`;

const SCORE_CLUSTER_SCHEMA = {
  type: "object",
  properties: {
    s: { type: "array", items: { type: "array", items: { type: "integer" } } },
    c: { type: "array", items: { type: "array", items: { type: "integer" } } },
  },
  required: ["s", "c"],
  additionalProperties: false,
};

interface ScoreClusterResult {
  s: number[][];
  c: number[][];
}

interface StoredScoreCluster {
  result: ScoreClusterResult;
  usage: TokenUsage;
  /** When the underlying API call actually ran — used to tell cache hits from fresh calls. */
  at: number;
}

/** Throws on any failure so bad results are never written to the data cache. */
async function scoreClusterCall(payload: string, model: string): Promise<StoredScoreCluster> {
  const res = await client.messages.create({
    model,
    // Compact triples for ~40 articles plus clusters fit well under this;
    // the cap bounds the cost of a pathologically verbose response.
    max_tokens: 1500,
    system: SCORE_CLUSTER_SYSTEM,
    // Structured output guarantees parseable JSON, so we never pay for a
    // scoring call only to discard it on a parse failure and silently fall
    // back to keyword ranking.
    output_config: {
      format: { type: "json_schema", schema: SCORE_CLUSTER_SCHEMA },
    },
    messages: [{ role: "user", content: payload }],
  });
  const result = JSON.parse(textOf(res)) as ScoreClusterResult;
  return { result, usage: readUsage(res), at: Date.now() };
}

// Scores and clusters depend only on the article set and interests — not on
// the summary model, sort order, or time of day — so they're cached against
// exactly those inputs. Force-refreshes where the feeds haven't changed and
// summary-model switches reuse the stored result instead of re-paying the
// call.
const SCORE_CACHE_SECONDS = 60 * 60 * 24;

function cachedScoreCluster(
  payload: string,
  links: string[],
  interests: string[],
  model: string,
): Promise<StoredScoreCluster> {
  // Keyed on article identity (links, in order — ids are positional) rather
  // than the full payload, so an excerpt byte-tweak in a feed doesn't bust
  // the cache. Same tradeoff the per-article summary cache makes.
  const key = createHash("sha256")
    .update(JSON.stringify({ links, interests, model }))
    .digest("hex")
    .slice(0, 16);
  const fetcher = unstable_cache(
    async () => scoreClusterCall(payload, model),
    ["score-cluster-v1", key],
    { revalidate: SCORE_CACHE_SECONDS },
  );
  return fetcher();
}

/**
 * One call does both relevance scoring and event clustering. The ~40-article
 * payload is the bulk of this stage's input tokens, so sending it once
 * instead of twice (the old separate scoring + clustering calls) roughly
 * halves the pre-summary input cost.
 *
 * On any failure (network, malformed output) falls back to the prefilter's
 * keyword-match ranking with singleton clusters, so the briefing still
 * builds instead of 500ing. Failures are never cached.
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
  const payload = JSON.stringify({
    interests: interests.map((t, i) => ({ i, t })),
    articles: indexed,
  });

  let stored: StoredScoreCluster;
  try {
    stored = await cachedScoreCluster(
      payload,
      candidates.map((c) => c.article.link),
      interests,
      model,
    );
  } catch {
    return { ...fallback(), usage: EMPTY_USAGE };
  }

  // Only count tokens actually spent on this pull — a stored `at` more than
  // a minute old means the value came from the data cache, not a fresh call.
  const usage = Date.now() - stored.at < 60_000 ? stored.usage : EMPTY_USAGE;

  const byId = new Map<number, { score: number; interestIdx: number }>();
  for (const row of stored.result.s ?? []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [id, score, interestIdx = -1] = row;
    if (!Number.isInteger(id)) continue;
    byId.set(id, { score, interestIdx });
  }
  const articles = candidates.map((c, i) => {
    const s = byId.get(i);
    return {
      ...c.article,
      score: s?.score ?? 0,
      matchedInterest:
        s && Number.isInteger(s.interestIdx) && s.interestIdx >= 0 && s.interestIdx < interests.length
          ? interests[s.interestIdx]
          : null,
    };
  });

  // Validate clusters: each id used at most once, in range; anything the
  // model dropped becomes its own singleton cluster.
  const seen = new Set<number>();
  const clusters: number[][] = [];
  for (const group of stored.result.c ?? []) {
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

const SUMMARY_SYSTEM = `You are a senior news editor writing a daily briefing. Write a 6-8 sentence summary of the news article excerpt the user provides. The summary must:
- Open with the most newsworthy fact, not the source
- Explain why it matters to a reader interested in finance, markets, business, and policy
- Be self-contained (the reader will not click through unless intrigued)
- Use crisp, declarative sentences in active voice
- Avoid hype, hedging, and filler phrases like "in a recent development"

Return only the summary text — no headers, no preamble, no quotation marks.`;

async function summarizeOne(
  article: ScoredArticle,
  model: string,
): Promise<{ summary: string | null; usage: TokenUsage }> {
  const res = await client.messages.create({
    model,
    max_tokens: 400,
    system: SUMMARY_SYSTEM,
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
  return { summary: text.length > 0 ? text : null, usage: readUsage(res) };
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
    ["summary-v1", model, linkKey],
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
