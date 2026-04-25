import Anthropic from "@anthropic-ai/sdk";
import type { RawArticle, ScoredArticle, SummarizedArticle } from "./types";

const client = new Anthropic();

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";

const RELEVANCE_SYSTEM = `You are a news curator. Given a user's interests and a list of news article excerpts, score each article 0-10 for how well it matches any of the interests. Return strict JSON only.

Scoring guidance:
- 9-10: directly about a stated interest, high signal
- 6-8: meaningfully touches a stated interest
- 3-5: tangentially related
- 0-2: unrelated

Return JSON of the form: {"scores":[{"id":<number>,"score":<0-10>,"interest":"<matched interest or empty string>"}]}`;

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
): Promise<ScoredArticle[]> {
  if (candidates.length === 0) return [];
  if (interests.length === 0) {
    return candidates.map((c) => ({
      ...c.article,
      score: 0,
      matchedInterest: null,
    }));
  }

  const indexed = candidates.map((c, i) => ({
    id: i,
    title: c.article.title,
    excerpt: c.article.excerpt.slice(0, 280),
    source: c.article.sourceName,
  }));

  const userPayload = JSON.stringify({ interests, articles: indexed });

  const res = await client.messages.create({
    model: HAIKU,
    max_tokens: 1500,
    system: [
      { type: "text", text: RELEVANCE_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPayload }],
  });

  const text = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = parseJson<ScoreResult>(text);
  const byId = new Map(parsed.scores.map((s) => [s.id, s]));

  return candidates.map((c, i) => {
    const s = byId.get(i);
    return {
      ...c.article,
      score: s?.score ?? 0,
      matchedInterest: s?.interest && s.interest.length > 0 ? s.interest : null,
    };
  });
}

export async function summarizeArticles(
  scored: ScoredArticle[],
): Promise<SummarizedArticle[]> {
  if (scored.length === 0) return [];

  const indexed = scored.map((a, i) => ({
    id: i,
    source: a.sourceName,
    title: a.title,
    excerpt: a.excerpt,
  }));

  const userPayload = JSON.stringify({ articles: indexed });

  const res = await client.messages.create({
    model: SONNET,
    max_tokens: 4000,
    system: [
      { type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPayload }],
  });

  const text = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = parseJson<SummaryResult>(text);
  const byId = new Map(parsed.summaries.map((s) => [s.id, s.summary]));

  return scored.map((a, i) => ({
    ...a,
    summary: byId.get(i) ?? "Summary unavailable.",
  }));
}
