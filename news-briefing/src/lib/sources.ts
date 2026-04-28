import type { SourceFeed } from "./types";

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
];
