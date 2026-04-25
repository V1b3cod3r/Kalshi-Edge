import { fetchAllArticles } from "./rss";
import { prefilter } from "./prefilter";
import {
  scoreRelevance,
  summarizeArticles,
  costFor,
  SCORING_MODEL,
  SUMMARY_MODEL,
} from "./claude";
import type { Briefing } from "./types";

const TOP_N = 15;
const PREFILTER_POOL = 40;

export async function buildBriefing(interests: string[]): Promise<Briefing> {
  const all = await fetchAllArticles();
  const candidates = prefilter(all, interests, PREFILTER_POOL);
  const { articles: scored, usage: scoringUsage } = await scoreRelevance(
    candidates,
    interests,
  );

  const top = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const { articles: summarized, usage: summaryUsage } =
    await summarizeArticles(top);

  const scoringCost = costFor(SCORING_MODEL, scoringUsage);
  const summaryCost = costFor(SUMMARY_MODEL, summaryUsage);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles: summarized,
    cost: {
      scoring: scoringCost,
      summary: summaryCost,
      total: scoringCost + summaryCost,
      scoringUsage,
      summaryUsage,
      scoringModel: SCORING_MODEL,
      summaryModel: SUMMARY_MODEL,
    },
  };
}
