export type SourceId = "wsj" | "ft" | "economist";

export interface SourceFeed {
  id: SourceId;
  name: string;
  url: string;
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
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CostBreakdown {
  haiku: number;
  sonnet: number;
  total: number;
  haikuUsage: TokenUsage;
  sonnetUsage: TokenUsage;
}

export interface Briefing {
  generatedAt: string;
  date: string;
  interests: string[];
  articles: SummarizedArticle[];
  cost: CostBreakdown;
}
