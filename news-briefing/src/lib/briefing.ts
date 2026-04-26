import { fetchAllArticles } from "./rss";
import { prefilter } from "./prefilter";
import {
  scoreRelevance,
  clusterArticles,
  summarizeArticles,
  costFor,
  SCORING_MODEL,
  SUMMARY_MODEL,
} from "./claude";
import type { Briefing, RelatedArticle, SummarizedArticle } from "./types";

const CLUSTER_POOL = 22;
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

  // Take top by score, then cluster duplicates so we summarize each underlying
  // story once. Use the cheap scoring model for clustering — it's a structural
  // task, not a writing task.
  const topForClustering = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, CLUSTER_POOL);

  const { clusters, usage: clusteringUsage } = await clusterArticles(
    topForClustering,
    scoringModel,
  );

  // Pick the highest-scoring article in each cluster as the representative.
  // Then keep the top N clusters (by representative's score).
  const cards = clusters
    .map((indices) => {
      const sorted = [...indices].sort(
        (a, b) => topForClustering[b].score - topForClustering[a].score,
      );
      const primary = topForClustering[sorted[0]];
      const related: RelatedArticle[] = sorted.slice(1).map((i) => {
        const a = topForClustering[i];
        return {
          source: a.source,
          sourceName: a.sourceName,
          title: a.title,
          link: a.link,
        };
      });
      return { primary, related };
    })
    .sort((a, b) => b.primary.score - a.primary.score)
    .slice(0, TOP_N);

  const { summaries, usage: summaryUsage } = await summarizeArticles(
    cards.map((c) => c.primary),
    summaryModel,
  );

  const articles: SummarizedArticle[] = cards.map((c, i) => ({
    ...c.primary,
    summary: summaries.get(i) ?? "Summary unavailable.",
    related: c.related,
  }));

  const scoringCost = costFor(scoringModel, scoringUsage);
  const clusteringCost = costFor(scoringModel, clusteringUsage);
  const summaryCost = costFor(summaryModel, summaryUsage);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles,
    cost: {
      scoring: scoringCost,
      clustering: clusteringCost,
      summary: summaryCost,
      total: scoringCost + clusteringCost + summaryCost,
      scoringUsage,
      clusteringUsage,
      summaryUsage,
      scoringModel,
      summaryModel,
    },
  };
}
