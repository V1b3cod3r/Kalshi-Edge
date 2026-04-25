import type { SourceFeed } from "./types";

const DAILY = 36;
const WEEKLY = 24 * 7;

export const SOURCES: SourceFeed[] = [
  // Wall Street Journal
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
  // Financial Times
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
  // The Economist (weekly publication — needs a wider window)
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
  // Reuters — wire service, free, high-volume
  {
    id: "reuters",
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    recencyHours: DAILY,
  },
  {
    id: "reuters",
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?best-topics=markets&post_type=best",
    recencyHours: DAILY,
  },
  {
    id: "reuters",
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best",
    recencyHours: DAILY,
  },
  // Bloomberg — most public RSS retired; opinion is the reliable one
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
  // Axios — concise, daily-briefing style
  {
    id: "axios",
    name: "Axios",
    url: "https://api.axios.com/feed/business",
    recencyHours: DAILY,
  },
  {
    id: "axios",
    name: "Axios",
    url: "https://api.axios.com/feed/technology",
    recencyHours: DAILY,
  },
  {
    id: "axios",
    name: "Axios",
    url: "https://api.axios.com/feed/world",
    recencyHours: DAILY,
  },
  // Semafor — newer, business and tech
  {
    id: "semafor",
    name: "Semafor",
    url: "https://www.semafor.com/api/rss/business.xml",
    recencyHours: DAILY,
  },
  {
    id: "semafor",
    name: "Semafor",
    url: "https://www.semafor.com/api/rss/technology.xml",
    recencyHours: DAILY,
  },
  // Federal Reserve — direct from the source, high signal for rate-policy interest
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
  // Politico — strong on regulation and policy
  {
    id: "politico",
    name: "Politico",
    url: "https://rss.politico.com/economy.xml",
    recencyHours: DAILY,
  },
  {
    id: "politico",
    name: "Politico",
    url: "https://rss.politico.com/energy.xml",
    recencyHours: DAILY,
  },
  // New York Times — business
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
];
