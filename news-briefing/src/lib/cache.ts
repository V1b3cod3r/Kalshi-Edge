import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import { buildBriefing, type BriefingOptions } from "./briefing";
import type { Briefing } from "./types";

function hashInterests(interests: string[]): string {
  const normalized = [...interests]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function modelTag(options: BriefingOptions): string {
  const s = (options.scoringModel || "default").replace("claude-", "");
  const m = (options.summaryModel || "default").replace("claude-", "");
  return `${s}_${m}`;
}

export async function getCachedBriefing(
  interests: string[],
  force = false,
  options: BriefingOptions = {},
): Promise<Briefing> {
  const key = `briefing-v6-${todayKey()}-${hashInterests(interests)}-${modelTag(options)}`;
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
