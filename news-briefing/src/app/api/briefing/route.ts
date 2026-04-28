import { NextResponse, type NextRequest } from "next/server";
import { getCachedBriefing } from "@/lib/cache";
import { MODEL_IDS } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 60;

function pickModel(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_IDS.has(value as never) ? value : undefined;
}

export async function POST(req: NextRequest) {
  let body: { interests?: unknown; refresh?: unknown; models?: unknown };
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
  const scoringModel = pickModel(modelsInput.scoring);
  const summaryModel = pickModel(modelsInput.summary);

  try {
    const briefing = await getCachedBriefing(interests, force, {
      scoringModel,
      summaryModel,
    });
    return NextResponse.json(briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
