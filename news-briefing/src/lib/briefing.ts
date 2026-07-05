import { fetchAllArticles } from "./rss";
import { prefilter } from "./prefilter";
import { SOURCES } from "./sources";
import {
  scoreAndCluster,
  summarizeArticles,
  costFor,
  EMPTY_USAGE,
  SCORING_MODEL,
  SUMMARY_MODEL,
} from "./claude";
import type {
  Briefing,
  RelatedArticle,
  ScoredArticle,
  SourceId,
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

// Sources that publish less than daily (Economist, Fed speeches). A 3-day-old
// Economist piece isn't "stale" the way a 3-day-old wire story is — it's
// still that week's coverage — so these are exempt from the "old news" dock
// below (though they still get the positive boost for genuinely fresh items).
const SLOW_CADENCE_SOURCES = new Set<SourceId>(
  SOURCES.filter((f) => f.recencyHours > 24).map((f) => f.id),
);

/**
 * Adjustment to the LLM relevance score based on how recent the article is.
 * Lets a 2h-old article with score 6 outrank a 14h-old article with score 8,
 * which matches the user's mental model of "today's news".
 */
export function recencyAdjustment(publishedAt: string, source: SourceId): number {
  const stale = SLOW_CADENCE_SOURCES.has(source) ? 0 : -1;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return stale;
  const hours = (Date.now() - t) / 3_600_000;
  if (hours < 3) return 2;
  if (hours < 9) return 1;
  if (hours < 15) return 0;
  return stale;
}

export interface BriefingOptions {
  summaryModel?: string;
  forceFresh?: boolean;
  /** Source ids to fetch. Omit to fetch all configured sources. */
  enabledSources?: SourceId[];
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
  // Scoring and clustering are both internal ranking calls — the user never
  // reads their output directly — so they always run on Haiku regardless of
  // the summary model choice. This is also what keeps the app inside
  // Vercel's 60s function budget even when the user picks Sonnet/Opus for
  // summaries.
  const summaryModel = options.summaryModel || SUMMARY_MODEL;

  const enabledSet = options.enabledSources ? new Set(options.enabledSources) : undefined;
  const { articles: all, downSources } = await fetchAllArticles(options.forceFresh, enabledSet);
  const candidates = prefilter(all, interests, PREFILTER_POOL);

  // One merged Haiku call both scores relevance and clusters by event.
  // The article payload dominates this stage's input tokens, so sending it
  // once instead of twice (the old separate scoring + clustering calls)
  // roughly halves the pre-summary input cost.
  const { articles: scored, clusters, usage: scoreClusterUsage } =
    await scoreAndCluster(candidates, interests, SCORING_MODEL);

  // Apply the recency adjustment so newer articles bubble up among
  // similarly-relevant peers. Cluster indices map into this same array
  // (same order as `candidates` -> `rawCandidates`).
  const pool: ScoredArticle[] = scored
    .slice(0, CLUSTER_POOL)
    .map((a) => ({
      ...a,
      score: a.score + recencyAdjustment(a.publishedAt, a.source),
    }));

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

  const scoringCost = costFor(SCORING_MODEL, scoreClusterUsage);
  // Clustering is merged into the scoring call — one payload, one price.
  const clusteringCost = 0;
  const summaryCost = costFor(summaryModel, summaryUsage);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles,
    topStories,
    downSources,
    cost: {
      scoring: scoringCost,
      clustering: clusteringCost,
      summary: summaryCost,
      total: scoringCost + clusteringCost + summaryCost,
      scoringUsage: scoreClusterUsage,
      clusteringUsage: EMPTY_USAGE,
      summaryUsage,
      scoringModel: SCORING_MODEL,
      summaryModel,
    },
  };
}
