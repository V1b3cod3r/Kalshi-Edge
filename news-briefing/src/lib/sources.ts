import type { SourceFeed, SourceId } from "./types";

const DAILY = 18;
const WEEKLY = 24 * 7;

export const SOURCES: SourceFeed[] = [
  // Wall Street Journal — verified working
  {
    id: "wsj",
    name: "Wall Street Journal",
    url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    recencyHours: DAILY,
  },
  {
    id: "wsj",
    name: "Wall Street Journal",
    url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    recencyHours: DAILY,
  },
  {
    id: "wsj",
    name: "Wall Street Journal",
    url: "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness",
    recencyHours: DAILY,
  },
  // Financial Times — verified working
  {
    id: "ft",
    name: "Financial Times",
    url: "https://www.ft.com/rss/home",
    recencyHours: DAILY,
  },
  {
    id: "ft",
    name: "Financial Times",
    url: "https://www.ft.com/world?format=rss",
    recencyHours: DAILY,
  },
  {
    id: "ft",
    name: "Financial Times",
    url: "https://www.ft.com/markets?format=rss",
    recencyHours: DAILY,
  },
  // The Economist — weekly publication, 7-day window
  {
    id: "economist",
    name: "The Economist",
    url: "https://www.economist.com/finance-and-economics/rss.xml",
    recencyHours: WEEKLY,
  },
  {
    id: "economist",
    name: "The Economist",
    url: "https://www.economist.com/business/rss.xml",
    recencyHours: WEEKLY,
  },
  {
    id: "economist",
    name: "The Economist",
    url: "https://www.economist.com/leaders/rss.xml",
    recencyHours: WEEKLY,
  },
  {
    id: "economist",
    name: "The Economist",
    url: "https://www.economist.com/the-world-this-week/rss.xml",
    recencyHours: WEEKLY,
  },
  // Bloomberg — verified working
  {
    id: "bloomberg",
    name: "Bloomberg",
    url: "https://feeds.bloomberg.com/markets/news.rss",
    recencyHours: DAILY,
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    url: "https://feeds.bloomberg.com/economics/news.rss",
    recencyHours: DAILY,
  },
  // Federal Reserve — direct from source for rate-policy interest
  {
    id: "fed",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    recencyHours: WEEKLY,
  },
  {
    id: "fed",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
    recencyHours: WEEKLY,
  },
  // New York Times
  {
    id: "nyt",
    name: "New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    recencyHours: DAILY,
  },
  {
    id: "nyt",
    name: "New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
    recencyHours: DAILY,
  },
  // Politico — kept Energy (working); dropped Economy (only 3 total items)
  {
    id: "politico",
    name: "Politico",
    url: "https://rss.politico.com/energy.xml",
    recencyHours: DAILY,
  },
  // CNBC — markets-focused
  {
    id: "cnbc",
    name: "CNBC",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    recencyHours: DAILY,
  },
  {
    id: "cnbc",
    name: "CNBC",
    url: "https://www.cnbc.com/id/15839135/device/rss/rss.html",
    recencyHours: DAILY,
  },
  // MarketWatch — markets and personal finance
  {
    id: "marketwatch",
    name: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    recencyHours: DAILY,
  },
  // BBC Business — geopolitics-flavored business coverage
  {
    id: "bbc",
    name: "BBC Business",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    recencyHours: DAILY,
  },
  // The Guardian — UK/global business
  {
    id: "guardian",
    name: "Guardian Business",
    url: "https://www.theguardian.com/uk/business/rss",
    recencyHours: DAILY,
  },
  // Marginal Revolution — Tyler Cowen, daily-ish economics blog
  {
    id: "mr",
    name: "Marginal Revolution",
    url: "https://marginalrevolution.com/feed",
    recencyHours: DAILY,
  },
  // Project Syndicate — global economics/policy commentaries. Contributors
  // publish roughly weekly, not multiple times a day like a wire service, so
  // this uses the same 7-day window as the Economist/Fed rather than DAILY —
  // otherwise a great piece can age out of the 18h cutoff before it's ever
  // scored.
  {
    id: "ps",
    name: "Project Syndicate",
    url: "https://www.project-syndicate.org/rss",
    recencyHours: WEEKLY,
  },
];

export interface SourceInfo {
  id: SourceId;
  name: string;
}

// Deduped list of distinct outlets for UI display and validation — SOURCES
// has multiple feed URLs per source id (e.g. 3 WSJ feeds), but the user
// thinks in terms of outlets, not individual RSS URLs.
export const SOURCE_LIST: SourceInfo[] = (() => {
  const seen = new Set<SourceId>();
  const list: SourceInfo[] = [];
  for (const f of SOURCES) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    list.push({ id: f.id, name: f.name });
  }
  return list;
})();

export const SOURCE_IDS = new Set(SOURCE_LIST.map((s) => s.id));
