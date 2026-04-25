import { XMLParser } from "fast-xml-parser";
import { SOURCES } from "./sources";
import type { RawArticle, SourceFeed } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "#text" in v) {
    return String((v as { "#text": unknown })["#text"] ?? "");
  }
  return String(v);
}

async function fetchFeed(feed: SourceFeed): Promise<RawArticle[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "news-briefing/0.1 (+rss reader)" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list.flatMap((item: Record<string, unknown>): RawArticle[] => {
    const title = stripHtml(asText(item.title));
    const description = stripHtml(
      asText(item.description ?? item.summary ?? item["content:encoded"] ?? ""),
    );
    const linkRaw = item.link;
    const link =
      typeof linkRaw === "string"
        ? linkRaw
        : Array.isArray(linkRaw)
          ? asText(linkRaw[0])
          : asText((linkRaw as Record<string, unknown>)?.["@_href"] ?? linkRaw);
    const publishedAt = asText(item.pubDate ?? item.published ?? item.updated ?? "");
    if (!title || !link) return [];
    return [
      {
        source: feed.id,
        sourceName: feed.name,
        title,
        excerpt: description.slice(0, 600),
        link,
        publishedAt,
      },
    ];
  });
}

function dedupe(articles: RawArticle[]): RawArticle[] {
  const seen = new Set<string>();
  const out: RawArticle[] = [];
  for (const a of articles) {
    const key = a.link.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function within24h(a: RawArticle): boolean {
  const t = Date.parse(a.publishedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t < 36 * 60 * 60 * 1000;
}

export async function fetchAllArticles(): Promise<RawArticle[]> {
  const results = await Promise.allSettled(SOURCES.map(fetchFeed));
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupe(all).filter(within24h);
}
