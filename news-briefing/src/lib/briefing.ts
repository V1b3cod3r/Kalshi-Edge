import { fetchAllArticles } from "./rss";
import { prefilter } from "./prefilter";
import { scoreRelevance, summarizeArticles, costFor } from "./claude";
import type { Briefing } from "./types";

const TOP_N = 15;
const PREFILTER_POOL = 40;

export async function buildBriefing(interests: string[]): Promise<Briefing> {
  const all = await fetchAllArticles();
  const candidates = prefilter(all, interests, PREFILTER_POOL);
  const { articles: scored, usage: haikuUsage } = await scoreRelevance(
    candidates,
    interests,
  );

  const top = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const { articles: summarized, usage: sonnetUsage } =
    await summarizeArticles(top);

  const haikuCost = costFor("haiku", haikuUsage);
  const sonnetCost = costFor("sonnet", sonnetUsage);

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    interests,
    articles: summarized,
    cost: {
      haiku: haikuCost,
      sonnet: sonnetCost,
      total: haikuCost + sonnetCost,
      haikuUsage,
      sonnetUsage,
    },
  };
}
