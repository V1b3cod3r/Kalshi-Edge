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

export interface BriefingOptions {
  scoringModel?: string;
  summaryModel?: string;
}

export async function buildBriefing(
  interests: string[],
  options: BriefingOptions = {},
): Promise<Briefing> {
  const scoringModel = options.scoringModel || SCORING_MODEL;
  const summaryModel = options.summaryModel || SUMMARY_MODEL;

  const all = await fetchAllArticles();
  const candidates = prefilter(all, interests, PREFILTER_POOL);
  const { articles: scored, usage: scoringUsage } = await scoreRelevance(
    candidates,
    interests,
    scoringModel,
  );

  const top = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const { articles: summarized, usage: summaryUsage } =
    await summarizeArticles(top, summaryModel);

  const scoringCost = costFor(scoringModel, scoringUsage);
  const summaryCost = costFor(summaryModel, summaryUsage);

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
      scoringModel,
      summaryModel,
    },
  };
}
