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
import type {
  Briefing,
  RelatedArticle,
  ScoredArticle,
  SummarizedArticle,
} from "./types";

const PREFILTER_POOL = 40;
// Cluster the full prefilter pool (was 30) so light-interest days still
// surface multi-outlet "top stories" from the unmatched-but-recent fallback
// articles the prefilter mixes in.
const CLUSTER_POOL = 40;
const CURATED_N = 12;
const TOP_STORIES_N = 5;
const TOP_STORIES_MIN_CLUSTER_SIZE = 2;

export interface BriefingOptions {
  scoringModel?: string;
  summaryModel?: string;
}

interface ClusterCard {
  primary: ScoredArticle;
  related: RelatedArticle[];
}

function buildCard(indices: number[], pool: ScoredArticle[]): ClusterCard {
  const sorted = [...indices].sort((a, b) => pool[b].score - pool[a].score);
  const primary = pool[sorted[0]];
  const related: RelatedArticle[] = sorted.slice(1).map((i) => {
    const a = pool[i];
    return {
      source: a.source,
      sourceName: a.sourceName,
      title: a.title,
      link: a.link,
    };
  });
  return { primary, related };
}

function assemble(
  card: ClusterCard,
  summary: string | undefined,
): SummarizedArticle {
  return {
    ...card.primary,
    summary: summary ?? "Summary unavailable.",
    related: card.related,
  };
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

  // Pick the candidate pool for clustering. Sort by interest score so the
  // "curated" list comes from the most relevant articles, but keep the pool
  // wide enough to surface broadly-covered news for Top Stories.
  const pool = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, CLUSTER_POOL);

  const { clusters, usage: clusteringUsage } = await clusterArticles(
    pool,
    scoringModel,
  );

  const allCards = clusters
    .map((indices) => buildCard(indices, pool))
    .sort((a, b) => b.primary.score - a.primary.score);

  // Curated = top clusters by interest-match score.
  const curatedCards = allCards.slice(0, CURATED_N);

  // Top stories = remaining clusters that multiple outlets covered, sorted by
  // cluster size (more outlets = more newsworthy), tie-break by score.
  const topCards = allCards
    .slice(CURATED_N)
    .filter((c) => c.related.length + 1 >= TOP_STORIES_MIN_CLUSTER_SIZE)
    .sort((a, b) => {
      const sizeDiff = b.related.length - a.related.length;
      if (sizeDiff !== 0) return sizeDiff;
      return b.primary.score - a.primary.score;
    })
    .slice(0, TOP_STORIES_N);

  // One summarization call covers both sections.
  const allForSummary = [...curatedCards, ...topCards];
  const { summaries, usage: summaryUsage } = await summarizeArticles(
    allForSummary.map((c) => c.primary),
    summaryModel,
  );

  const articles = curatedCards.map((c, i) => assemble(c, summaries.get(i)));
  const topStories = topCards.map((c, i) =>
    assemble(c, summaries.get(curatedCards.length + i)),
  );

  const scoringCost = costFor(scoringModel, scoringUsage);
  const clusteringCost = costFor(scoringModel, clusteringUsage);
  const summaryCost = costFor(summaryModel, summaryUsage);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles,
    topStories,
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
