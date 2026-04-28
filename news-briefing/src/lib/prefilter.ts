import type { RawArticle } from "./types";

const STOPWORDS = new Set([
  "the","a","an","and","or","of","in","on","for","to","with","by","from","at",
  "is","are","was","were","be","been","it","its","this","that","these","those",
  "as","but","if","then","than","so","into","over","about","after","before",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

interface InterestTerms {
  raw: string;
  tokens: string[];
}

function expand(interests: string[]): InterestTerms[] {
  return interests.map((raw) => ({ raw, tokens: tokenize(raw) }));
}

export function prefilter(
  articles: RawArticle[],
  interests: string[],
  limit = 30,
): { article: RawArticle; matchedInterest: string | null; score: number }[] {
  if (interests.length === 0) {
    return articles
      .slice(0, limit)
      .map((a) => ({ article: a, matchedInterest: null, score: 0 }));
  }
  const terms = expand(interests);
  const scored = articles.map((a) => {
    const haystack = `${a.title} ${a.excerpt}`.toLowerCase();
    let best = 0;
    let bestInterest: string | null = null;
    for (const t of terms) {
      let hits = 0;
      for (const tok of t.tokens) if (haystack.includes(tok)) hits++;
      if (hits > best) {
        best = hits;
        bestInterest = t.raw;
      }
    }
    return { article: a, matchedInterest: bestInterest, score: best };
  });
  const matched = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (matched.length >= 12) return matched.slice(0, limit);
  // If too few keyword matches, fall back to including some recent unmatched
  // articles so the LLM relevance pass has material to work with.
  const unmatched = scored.filter((x) => x.score === 0).slice(0, limit - matched.length);
  return [...matched, ...unmatched].slice(0, limit);
}
