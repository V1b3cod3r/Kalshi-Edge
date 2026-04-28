import { XMLParser } from "fast-xml-parser";
import { SOURCES } from "./sources";
import type { RawArticle, SourceFeed } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

// Feed-reader-style UA — many publishers 403 unknown bots but allow
// well-formed reader UAs. Mozilla prefix is the convention.
const UA =
  "Mozilla/5.0 (compatible; news-briefing/1.0; +https://github.com/v1b3cod3r/kalshi-edge)";

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

export async function fetchFeed(feed: SourceFeed, forceFresh = false): Promise<RawArticle[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
    // 5-min cache normally so auto-loads are cheap; force=true bypasses
    // entirely so the refresh button actually pulls today's latest.
    ...(forceFresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const list = Array.isArray(items) ? items : [items];

  const cutoff = Date.now() - feed.recencyHours * 60 * 60 * 1000;

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
    const publishedAt = asText(
      item.pubDate ?? item.published ?? item.updated ?? item["dc:date"] ?? "",
    );
    if (!title || !link) return [];

    const t = Date.parse(publishedAt);
    if (!Number.isNaN(t) && t < cutoff) return [];

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

export async function fetchAllArticles(forceFresh = false): Promise<RawArticle[]> {
  const results = await Promise.allSettled(
    SOURCES.map((feed) => fetchFeed(feed, forceFresh)),
  );
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupe(all);
}
