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
  const key = `briefing-v4-${todayKey()}-${hashInterests(interests)}-${modelTag(options)}`;
  if (force) revalidateTag(key);
  const fetcher = unstable_cache(
    async () => buildBriefing(interests, options),
    [key],
    { revalidate: 60 * 60 * 12, tags: [key] },
  );
  return fetcher();
}
