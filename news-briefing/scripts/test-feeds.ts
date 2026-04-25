import { SOURCES } from "../src/lib/sources";
import { fetchFeed } from "../src/lib/rss";

interface Result {
  url: string;
  source: string;
  status: "ok" | "empty" | "error";
  itemCount: number;
  withinWindow: number;
  newest: string | null;
  newestAgeHours: number | null;
  windowHours: number;
  message?: string;
}

async function rawFetch(url: string): Promise<{ ok: boolean; status: number; xml: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; news-briefing/1.0; +https://github.com/v1b3cod3r/kalshi-edge)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    return { ok: res.ok, status: res.status, xml: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, xml: err instanceof Error ? err.message : String(err) };
  }
}

function rawItemCount(xml: string): number {
  const items = (xml.match(/<item[\s>]/g) || []).length;
  const entries = (xml.match(/<entry[\s>]/g) || []).length;
  return items + entries;
}

async function check(): Promise<void> {
  console.log(`\nTesting ${SOURCES.length} feeds...\n`);
  const results: Result[] = [];

  for (const feed of SOURCES) {
    const raw = await rawFetch(feed.url);
    if (!raw.ok) {
      results.push({
        url: feed.url,
        source: feed.name,
        status: "error",
        itemCount: 0,
        withinWindow: 0,
        newest: null,
        newestAgeHours: null,
        windowHours: feed.recencyHours,
        message: `HTTP ${raw.status}`,
      });
      continue;
    }
    const totalItems = rawItemCount(raw.xml);
    const articles = await fetchFeed(feed);
    const newest = articles
      .map((a) => Date.parse(a.publishedAt))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a)[0];
    results.push({
      url: feed.url,
      source: feed.name,
      status: articles.length === 0 ? "empty" : "ok",
      itemCount: totalItems,
      withinWindow: articles.length,
      newest: newest ? new Date(newest).toISOString() : null,
      newestAgeHours: newest ? +((Date.now() - newest) / 3600_000).toFixed(1) : null,
      windowHours: feed.recencyHours,
    });
  }

  // Print summary
  const colWidth = 28;
  console.log(
    "Source".padEnd(20) +
      "Status".padEnd(10) +
      "Total".padEnd(8) +
      "InWindow".padEnd(10) +
      "Window(h)".padEnd(11) +
      "NewestAge",
  );
  console.log("-".repeat(80));
  for (const r of results) {
    const status =
      r.status === "ok"
        ? "\x1b[32mOK\x1b[0m"
        : r.status === "empty"
          ? "\x1b[33mEMPTY\x1b[0m"
          : "\x1b[31mFAIL\x1b[0m";
    console.log(
      r.source.slice(0, 18).padEnd(20) +
        status.padEnd(19) +
        String(r.itemCount).padEnd(8) +
        String(r.withinWindow).padEnd(10) +
        String(r.windowHours).padEnd(11) +
        (r.newestAgeHours != null ? `${r.newestAgeHours}h` : "—") +
        (r.message ? `  (${r.message})` : ""),
    );
    console.log(`  ${r.url.slice(0, 78)}`);
  }
  console.log();

  const ok = results.filter((r) => r.status === "ok").length;
  const empty = results.filter((r) => r.status === "empty").length;
  const fail = results.filter((r) => r.status === "error").length;
  const totalArticles = results.reduce((s, r) => s + r.withinWindow, 0);
  console.log(
    `Summary: ${ok} working, ${empty} empty (HTTP ok but no items in window), ${fail} failed.`,
  );
  console.log(`Total articles in window across all feeds: ${totalArticles}\n`);

  if (fail > 0) {
    console.log("Failed feeds will return zero articles in production. Drop them from sources.ts.");
  }
  if (empty > 0) {
    console.log("Empty-window feeds may be dormant or have a recencyHours setting that's too tight.");
  }
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
