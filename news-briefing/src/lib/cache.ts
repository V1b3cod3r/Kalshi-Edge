import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import { buildBriefing, type BriefingOptions } from "./briefing";
import { SOURCE_LIST } from "./sources";
import type { Briefing } from "./types";

function hashInterests(interests: string[]): string {
  const normalized = [...interests]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// "Today" in US Eastern time, not UTC. UTC midnight falls at 7-8pm ET, so a
// plain UTC date slice would roll the cache over mid-evening and force a
// same-day rebuild right when the user is reading.
function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function modelTag(options: BriefingOptions): string {
  return (options.summaryModel || "default").replace("claude-", "");
}

// "all" for the common case (no filtering, or every source explicitly
// enabled) so toggling doesn't fragment the cache for people who never
// touch this setting. Otherwise hash the sorted id list.
function sourcesTag(options: BriefingOptions): string {
  const enabled = options.enabledSources;
  if (!enabled || new Set(enabled).size >= SOURCE_LIST.length) return "all";
  return createHash("sha256").update([...new Set(enabled)].sort().join("|")).digest("hex").slice(0, 8);
}

export async function getCachedBriefing(
  interests: string[],
  force = false,
  options: BriefingOptions = {},
): Promise<Briefing> {
  const key = `briefing-v12-${todayKey()}-${hashInterests(interests)}-${modelTag(options)}-${sourcesTag(options)}`;
  if (force) revalidateTag(key);
  // When the user clicks refresh we also bypass the RSS-level cache so we
  // actually pull whatever just hit the wire, not whatever was cached
  // up to 5 minutes ago.
  const buildOptions: BriefingOptions = { ...options, forceFresh: force };
  const fetcher = unstable_cache(
    async () => buildBriefing(interests, buildOptions),
    [key],
    { revalidate: 60 * 60 * 12, tags: [key] },
  );
  return fetcher();
}
