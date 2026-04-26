export type SourceId =
  | "wsj"
  | "ft"
  | "economist"
  | "bloomberg"
  | "nyt"
  | "politico"
  | "fed"
  | "cnbc"
  | "marketwatch"
  | "bbc"
  | "guardian"
  | "mr";

export interface SourceFeed {
  id: SourceId;
  name: string;
  url: string;
  /** How recent an article must be to qualify. Daily wires use 36h; weeklies (Economist) use 168h (7 days). */
  recencyHours: number;
}

export interface RawArticle {
  source: SourceId;
  sourceName: string;
  title: string;
  excerpt: string;
  link: string;
  publishedAt: string;
}

export interface ScoredArticle extends RawArticle {
  score: number;
  matchedInterest: string | null;
}

export interface SummarizedArticle extends ScoredArticle {
  summary: string;
  /** Other articles in the same cluster (same news event from different outlets). */
  related: RelatedArticle[];
}

export interface RelatedArticle {
  source: SourceId;
  sourceName: string;
  title: string;
  link: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CostBreakdown {
  scoring: number;
  clustering: number;
  summary: number;
  total: number;
  scoringUsage: TokenUsage;
  clusteringUsage: TokenUsage;
  summaryUsage: TokenUsage;
  scoringModel: string;
  summaryModel: string;
}

export interface Briefing {
  generatedAt: string;
  date: string;
  interests: string[];
  articles: SummarizedArticle[];
  cost: CostBreakdown;
}
