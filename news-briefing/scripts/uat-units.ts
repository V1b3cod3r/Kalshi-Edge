// Focused unit tests for pure helpers — exercises the edge cases I flagged
// in the audit so I can confirm bugs before fixing them.
import { prefilter } from "../src/lib/prefilter";
import { formatRelative } from "../src/lib/time";
import type { RawArticle } from "../src/lib/types";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
}

function art(title: string, excerpt = "", source = "wsj"): RawArticle {
  return {
    source: source as RawArticle["source"],
    sourceName: "WSJ",
    title,
    excerpt,
    link: `https://x/${title.toLowerCase().replace(/\s+/g, "-")}`,
    publishedAt: new Date().toISOString(),
  };
}

// --- prefilter ---
{
  // Previously bug: "AI" got filtered (len<=2). Fix: keep len>=2 + word-boundary match.
  const arts = [art("OpenAI ships AI agent"), art("Ukraine peace talks resume")];
  const r = prefilter(arts, ["AI"], 10);
  const matched = r.filter((x) => x.score > 0);
  ok(
    "prefilter: 'AI' interest now matches 'AI agent' title",
    matched.length === 1 && matched[0].article.title.includes("AI agent"),
    `matched=${matched.length}`,
  );
  // And no false positive on Ukraine (substring "ai" inside Ukraine).
  const ukraine = r.find((x) => x.article.title.includes("Ukraine"));
  ok(
    "prefilter: 'AI' does NOT false-positive on 'Ukraine' (word-boundary match)",
    ukraine !== undefined && ukraine.score === 0,
  );
}
{
  // Plural morphology: interest "rate" should still match article about "rates"
  const arts = [art("Fed holds rates steady")];
  const r = prefilter(arts, ["rate cut"], 10);
  ok(
    "prefilter: morphology — 'rate' matches 'rates'",
    r[0].score > 0,
  );
}
{
  // Substring matching: "energy" matches "energies"/"energetic". Genuine fp risk
  // but in practice low. Confirm the mechanism still works for plain match.
  const arts = [art("Energy sector tightens output")];
  const r = prefilter(arts, ["energy and commodities"], 10);
  ok("prefilter: plain match works", r[0].score > 0);
}
{
  // Empty interests path: returns first N regardless of content.
  const arts = [art("a"), art("b"), art("c")];
  const r = prefilter(arts, [], 2);
  ok("prefilter: empty interests returns first N", r.length === 2 && r[0].article.title === "a");
}
{
  // Falls back to recent unmatched when matched < 12.
  const arts = Array.from({ length: 5 }, (_, i) => art(`x${i}`, "no match here"));
  const r = prefilter(arts, ["banana"], 10);
  ok("prefilter: fallback unmatched when matched<12", r.length === 5);
}

// --- formatRelative ---
const NOW = Date.parse("2026-05-02T12:00:00Z");
ok("time: NaN input -> ''", formatRelative("garbage", NOW) === "");
ok("time: future -> 'just now'", formatRelative("2026-05-02T12:00:30Z", NOW) === "just now");
ok("time: 30s ago -> 'just now'", formatRelative("2026-05-02T11:59:30Z", NOW) === "just now");
ok("time: 5m ago", formatRelative("2026-05-02T11:55:00Z", NOW) === "5m ago");
ok("time: 3h ago", formatRelative("2026-05-02T09:00:00Z", NOW) === "3h ago");
ok("time: 1d ago -> 'yesterday'", formatRelative("2026-05-01T12:00:00Z", NOW) === "yesterday");
ok("time: 3d ago", formatRelative("2026-04-29T12:00:00Z", NOW) === "3d ago");
ok("time: 2w ago", formatRelative("2026-04-18T12:00:00Z", NOW) === "2w ago");
ok(
  "time: 6 months ago -> date string",
  /[A-Z][a-z]{2} \d+/.test(formatRelative("2025-11-01T12:00:00Z", NOW)),
);

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
