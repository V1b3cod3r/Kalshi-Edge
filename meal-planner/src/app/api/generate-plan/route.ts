import { NextResponse, type NextRequest } from "next/server";
import { costFor, generateMealPlan, PLAN_MODEL } from "@/lib/claude";
import type { GeneratePlanResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { preferences?: unknown; pantry?: unknown; servingsPerMeal?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const preferences = typeof body.preferences === "string" ? body.preferences.trim().slice(0, 2000) : "";
  const pantry = Array.isArray(body.pantry)
    ? body.pantry
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200)
    : [];
  const servingsPerMeal =
    typeof body.servingsPerMeal === "number" && body.servingsPerMeal >= 1 && body.servingsPerMeal <= 8
      ? Math.round(body.servingsPerMeal)
      : 2;

  try {
    const { plan, usage } = await generateMealPlan({ preferences, pantry, servingsPerMeal });
    const response: GeneratePlanResponse = {
      plan,
      cost: costFor(PLAN_MODEL, usage),
      usage,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
