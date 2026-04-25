import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import { buildBriefing } from "./briefing";
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

export async function getCachedBriefing(
  interests: string[],
  force = false,
): Promise<Briefing> {
  const key = `briefing-${todayKey()}-${hashInterests(interests)}`;
  if (force) revalidateTag(key);
  const fetcher = unstable_cache(
    async () => buildBriefing(interests),
    [key],
    { revalidate: 60 * 60 * 12, tags: [key] },
  );
  return fetcher();
}
