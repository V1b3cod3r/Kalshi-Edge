import Anthropic from "@anthropic-ai/sdk";
import type {
  RawArticle,
  ScoredArticle,
  TokenUsage,
} from "./types";

const client = new Anthropic();

// Default models when the caller doesn't specify. All three calls accept a
// per-request override from the UI; see scoreRelevance() / clusterArticles() /
// summarizeArticles().
export const SCORING_MODEL = "claude-haiku-4-5";
export const SUMMARY_MODEL = "claude-haiku-4-5";

// $ per million tokens
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
};

const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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

const RELEVANCE_SYSTEM = `You are a news curator. Given a user's interests and a list of news article excerpts, score each article 0-10 for how well it matches any of the interests. Return strict JSON only.

Scoring guidance:
- 9-10: directly about a stated interest, high signal
- 6-8: meaningfully touches a stated interest
- 3-5: tangentially related
- 0-2: unrelated

Return JSON of the form: {"scores":[{"id":<number>,"score":<0-10>,"interest":"<matched interest or empty string>"}]}`;

const CLUSTER_SYSTEM = `You group news articles by underlying news event. Two articles belong in the same cluster if they cover the same underlying story (same event, same announcement, same actors, same day) — even if the angles or framings differ.

Be conservative: do NOT merge two articles that just share a topic ("AI" or "the Fed") but are about different events. Only merge true duplicates of the same story.

Each article id must appear in exactly one cluster. Singleton clusters (one article on its own) are normal and expected.

Return strict JSON only, in the form: {"clusters":[[<id>,<id>,...],[<id>],...]}`;

const SUMMARY_SYSTEM = `You are a senior news editor writing a daily briefing. For each article excerpt provided, write a 6-8 sentence summary that:
- Opens with the most newsworthy fact, not the source
- Explains why it matters to a reader interested in finance, markets, business, and policy
- Is self-contained (the reader will not click through unless intrigued)
- Uses crisp, declarative sentences in active voice
- Avoids hype, hedging, and filler phrases like "in a recent development"

Return strict JSON only, in the form: {"summaries":[{"id":<number>,"summary":"<6-8 sentences>"}]}`;

interface ScoreResult {
  scores: { id: number; score: number; interest: string }[];
}

interface ClusterResult {
  clusters: number[][];
}

interface SummaryResult {
  summaries: { id: number; summary: string }[];
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in model output");
  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

export async function scoreRelevance(
  candidates: { article: RawArticle; matchedInterest: string | null; score: number }[],
  interests: string[],
  model: string = SCORING_MODEL,
): Promise<{ articles: ScoredArticle[]; usage: TokenUsage }> {
  if (candidates.length === 0) return { articles: [], usage: EMPTY_USAGE };
  if (interests.length === 0) {
    return {
      articles: candidates.map((c) => ({
        ...c.article,
        score: 0,
        matchedInterest: null,
      })),
      usage: EMPTY_USAGE,
    };
  }

  const indexed = candidates.map((c, i) => ({
    id: i,
    title: c.article.title,
    excerpt: c.article.excerpt.slice(0, 280),
    source: c.article.sourceName,
  }));

  const userPayload = JSON.stringify({ interests, articles: indexed });

  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    system: [
      { type: "text", text: RELEVANCE_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPayload }],
  });

  const parsed = parseJson<ScoreResult>(textOf(res));
  const byId = new Map(parsed.scores.map((s) => [s.id, s]));

  const articles = candidates.map((c, i) => {
    const s = byId.get(i);
    return {
      ...c.article,
      score: s?.score ?? 0,
      matchedInterest: s?.interest && s.interest.length > 0 ? s.interest : null,
    };
  });

  return { articles, usage: readUsage(res) };
}

/**
 * Group articles that cover the same news event. Returns clusters as arrays
 * of input indices. Each input index appears in exactly one cluster (the
 * model is instructed to do so; this function defensively backfills any
 * missing ids as singletons).
 */
export async function clusterArticles(
  articles: ScoredArticle[],
  model: string = SCORING_MODEL,
): Promise<{ clusters: number[][]; usage: TokenUsage }> {
  if (articles.length <= 1) {
    return { clusters: articles.map((_, i) => [i]), usage: EMPTY_USAGE };
  }

  const indexed = articles.map((a, i) => ({
    id: i,
    source: a.sourceName,
    title: a.title,
    excerpt: a.excerpt.slice(0, 200),
  }));

  const res = await client.messages.create({
    model,
    max_tokens: 1500,
    system: [
      { type: "text", text: CLUSTER_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: JSON.stringify({ articles: indexed }) }],
  });

  let parsed: ClusterResult;
  try {
    parsed = parseJson<ClusterResult>(textOf(res));
  } catch {
    // Fall back to no clustering if the model output is malformed.
    return {
      clusters: articles.map((_, i) => [i]),
      usage: readUsage(res),
    };
  }

  const seen = new Set<number>();
  const clusters: number[][] = [];
  for (const group of parsed.clusters) {
    const valid: number[] = [];
    for (const id of group) {
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id >= articles.length ||
        seen.has(id)
      ) {
        continue;
      }
      seen.add(id);
      valid.push(id);
    }
    if (valid.length === 0) continue;
    clusters.push(valid);
  }
  // Defensive: anything the model dropped becomes its own cluster.
  for (let i = 0; i < articles.length; i++) {
    if (!seen.has(i)) clusters.push([i]);
  }

  return { clusters, usage: readUsage(res) };
}

export async function summarizeArticles(
  scored: ScoredArticle[],
  model: string = SUMMARY_MODEL,
): Promise<{ summaries: Map<number, string>; usage: TokenUsage }> {
  if (scored.length === 0) return { summaries: new Map(), usage: EMPTY_USAGE };

  const indexed = scored.map((a, i) => ({
    id: i,
    source: a.sourceName,
    title: a.title,
    excerpt: a.excerpt.slice(0, 400),
  }));

  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [
      { type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: JSON.stringify({ articles: indexed }) }],
  });

  const parsed = parseJson<SummaryResult>(textOf(res));
  const summaries = new Map(parsed.summaries.map((s) => [s.id, s.summary]));
  return { summaries, usage: readUsage(res) };
}
