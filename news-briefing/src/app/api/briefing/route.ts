import { NextResponse, type NextRequest } from "next/server";
import { getCachedBriefing } from "@/lib/cache";
import { MODEL_IDS } from "@/lib/models";
import { SOURCE_IDS } from "@/lib/sources";
import type { SourceId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function pickModel(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_IDS.has(value as never) ? value : undefined;
}

// Returns undefined only when the field is missing/malformed (old client,
// default to all sources). An explicit empty array is a real user choice
// (they turned every source off) and is passed through as-is.
function pickSources(value: unknown): SourceId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is SourceId => typeof v === "string" && SOURCE_IDS.has(v as SourceId));
}

export async function POST(req: NextRequest) {
  let body: { interests?: unknown; refresh?: unknown; models?: unknown; sources?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const interests = Array.isArray(body.interests)
    ? body.interests.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
    : [];

  if (interests.length > 30) {
    return NextResponse.json({ error: "too many interests" }, { status: 400 });
  }

  const force = body.refresh === true;
  const modelsInput =
    body.models && typeof body.models === "object" ? (body.models as Record<string, unknown>) : {};
  const summaryModel = pickModel(modelsInput.summary);
  const enabledSources = pickSources(body.sources);

  try {
    const briefing = await getCachedBriefing(interests, force, {
      summaryModel,
      enabledSources,
    });
    return NextResponse.json(briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
