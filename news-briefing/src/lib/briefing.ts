import { fetchAllArticles } from "./rss";
import { prefilter } from "./prefilter";
import { scoreRelevance, summarizeArticles } from "./claude";
import type { Briefing } from "./types";

const TOP_N = 8;
const MIN_SCORE = 4;

export async function buildBriefing(interests: string[]): Promise<Briefing> {
  const all = await fetchAllArticles();
  const candidates = prefilter(all, interests, 30);
  const scored = await scoreRelevance(candidates, interests);

  const ranked = scored
    .filter((a) => a.score >= MIN_SCORE || interests.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const top = ranked.length > 0 ? ranked : scored.slice(0, TOP_N);
  const summarized = await summarizeArticles(top);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles: summarized,
  };
}
