import { NextResponse, type NextRequest } from "next/server";
import { getCachedBriefing } from "@/lib/cache";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { interests?: unknown };
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

  try {
    const briefing = await getCachedBriefing(interests);
    return NextResponse.json(briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
