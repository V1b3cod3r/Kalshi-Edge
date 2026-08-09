import Anthropic from "@anthropic-ai/sdk";
import {
  SHOPPING_CATEGORIES,
  type DayPlan,
  type Ingredient,
  type Meal,
  type MealPlan,
  type ShoppingCategory,
  type ShoppingItem,
  type TokenUsage,
} from "./types";

const client = new Anthropic();

export const PLAN_MODEL = "claude-sonnet-4-6";

export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
};

export function costFor(model: string, usage: TokenUsage): number {
  const p = PRICING[model];
  if (!p) throw new Error(`No pricing entry for "${model}"`);
  const M = 1_000_000;
  return (
    (usage.input * p.input) / M +
    (usage.output * p.output) / M +
    (usage.cacheRead * p.input * 0.1) / M +
    (usage.cacheWrite * p.input * 1.25) / M
  );
}

function readUsage(res: Anthropic.Message): TokenUsage {
  return {
    input: res.usage.input_tokens ?? 0,
    output: res.usage.output_tokens ?? 0,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON in model output");
  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

const SYSTEM_PROMPT = `You are a meal planner. You produce a 7-day plan (Monday through Sunday) of breakfast, lunch, and dinner that is realistic for a home cook.

Hard rules:
- Respect every dietary restriction the user lists. Treat them as non-negotiable.
- Exclude items from the user's pantry from any new shopping. The pantry is what they ALREADY have. Still list those items inside each meal's ingredients (so the recipe is complete), but mark them with "fromPantry": true.
- Reuse ingredients across meals to keep the shopping list short and reduce waste.
- Use common, Amazon Fresh / Whole Foods staples. Avoid obscure imports.
- Each meal feeds the requested number of people. Default to 2.
- Quantities must be numeric and use a single unit. Allowed units: g, kg, oz, lb, ml, l, cup, tbsp, tsp, clove, can, jar, bunch, head, slice, whole. If something doesn't fit, use "whole" and round up.
- Ingredient names are lowercase, singular when possible, no quantities or descriptors that don't matter for shopping. Good: "boneless chicken thighs", "yellow onion", "garlic". Bad: "1 lb chicken (boneless, skinless)".
- Keep breakfast simple and fast (5-10 min hands-on). Lunch should often reuse last night's dinner protein. Dinner can be more involved.

Return STRICT JSON only, in this exact shape:

{
  "notes": "<1-2 sentences about themes for the week, or null>",
  "days": [
    {
      "day": "Monday",
      "meals": [
        {
          "slot": "breakfast" | "lunch" | "dinner",
          "title": "<short dish name>",
          "description": "<1-3 sentence description>",
          "servings": <number>,
          "ingredients": [
            {
              "name": "<lowercase ingredient name>",
              "amount": <number>,
              "unit": "<one of the allowed units>",
              "category": "produce" | "meat-seafood" | "dairy-eggs" | "pantry" | "grains-bread" | "frozen" | "beverages" | "other",
              "fromPantry": <boolean>
            }
          ]
        }
      ]
    }
  ]
}

Return exactly 7 days, exactly 3 meals per day. No prose outside the JSON.`;

interface ModelIngredient {
  name: string;
  amount: number;
  unit: string;
  category: string;
  fromPantry?: boolean;
}

interface ModelMeal {
  slot: string;
  title: string;
  description: string;
  servings: number;
  ingredients: ModelIngredient[];
}

interface ModelDay {
  day: string;
  meals: ModelMeal[];
}

interface ModelResponse {
  notes: string | null;
  days: ModelDay[];
}

export interface PlanInputs {
  preferences: string;
  pantry: string[];
  servingsPerMeal: number;
}

export async function generateMealPlan(
  inputs: PlanInputs,
  model: string = PLAN_MODEL,
): Promise<{ plan: MealPlan; usage: TokenUsage }> {
  const userPayload = JSON.stringify({
    dietaryPreferences: inputs.preferences || "(none)",
    pantry: inputs.pantry,
    servingsPerMeal: inputs.servingsPerMeal,
  });

  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPayload }],
  });

  const parsed = parseJson<ModelResponse>(textOf(res));
  const days = sanitizeDays(parsed.days);
  const shoppingList = aggregateShoppingList(days, parsed.days);

  return {
    plan: {
      generatedAt: new Date().toISOString(),
      days,
      shoppingList,
      notes: parsed.notes ?? null,
    },
    usage: readUsage(res),
  };
}

const ALLOWED_SLOTS = new Set(["breakfast", "lunch", "dinner"]);
const CATEGORY_SET = new Set<string>(SHOPPING_CATEGORIES);

function sanitizeDays(input: ModelDay[]): DayPlan[] {
  return input.map((d) => ({
    day: typeof d.day === "string" && d.day.trim() ? d.day.trim() : "Day",
    meals: (d.meals ?? [])
      .filter((m) => ALLOWED_SLOTS.has(m.slot))
      .map(sanitizeMeal),
  }));
}

function sanitizeMeal(m: ModelMeal): Meal {
  return {
    slot: m.slot as Meal["slot"],
    title: typeof m.title === "string" ? m.title.trim() : "Untitled",
    description: typeof m.description === "string" ? m.description.trim() : "",
    servings: Number.isFinite(m.servings) && m.servings > 0 ? Math.round(m.servings) : 2,
    ingredients: (m.ingredients ?? []).map(sanitizeIngredient),
  };
}

function sanitizeIngredient(i: ModelIngredient): Ingredient {
  return {
    name: typeof i.name === "string" ? i.name.toLowerCase().trim() : "unknown",
    amount: Number.isFinite(i.amount) && i.amount > 0 ? i.amount : 1,
    unit: typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : "whole",
    category: CATEGORY_SET.has(i.category) ? (i.category as ShoppingCategory) : "other",
  };
}

/**
 * Roll up every non-pantry ingredient across the week into one shopping line per
 * (name, unit) pair. We cross-reference the original model output so we know
 * which ingredients to skip (the user already has them).
 */
function aggregateShoppingList(days: DayPlan[], rawDays: ModelDay[]): ShoppingItem[] {
  type Key = string;
  const acc = new Map<Key, ShoppingItem>();

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    const rawDay = rawDays[di];
    for (let mi = 0; mi < day.meals.length; mi++) {
      const meal = day.meals[mi];
      const rawMeal = rawDay?.meals?.[mi];
      for (let ii = 0; ii < meal.ingredients.length; ii++) {
        const ing = meal.ingredients[ii];
        const rawIng = rawMeal?.ingredients?.[ii];
        if (rawIng?.fromPantry === true) continue;

        const key = `${ing.name}::${ing.unit}`;
        const existing = acc.get(key);
        if (existing) {
          existing.amount += ing.amount;
          if (!existing.usedIn.includes(meal.title)) existing.usedIn.push(meal.title);
        } else {
          acc.set(key, {
            name: ing.name,
            amount: ing.amount,
            unit: ing.unit,
            category: ing.category,
            usedIn: [meal.title],
          });
        }
      }
    }
  }

  return [...acc.values()].sort((a, b) => {
    const ca = SHOPPING_CATEGORIES.indexOf(a.category);
    const cb = SHOPPING_CATEGORIES.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
}
