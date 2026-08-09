export type MealSlot = "breakfast" | "lunch" | "dinner";

export interface Ingredient {
  /** Display name as it should appear in the shopping list. Lowercase, no quantities. */
  name: string;
  /** Numeric amount in `unit`. Combined across meals when names match. */
  amount: number;
  /** Free-form unit string ("g", "lb", "tbsp", "clove", "can", "whole"). */
  unit: string;
  /** Aisle/category for grouping in the shopping list. */
  category: ShoppingCategory;
}

export const SHOPPING_CATEGORIES = [
  "produce",
  "meat-seafood",
  "dairy-eggs",
  "pantry",
  "grains-bread",
  "frozen",
  "beverages",
  "other",
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

export interface Meal {
  slot: MealSlot;
  title: string;
  /** 1-3 sentence blurb describing the dish. */
  description: string;
  /** Servings produced; use 2 unless the user asks otherwise. */
  servings: number;
  /** Ingredients as used in this meal (pre-aggregation). */
  ingredients: Ingredient[];
}

export interface DayPlan {
  /** "Monday", "Tuesday", … */
  day: string;
  meals: Meal[];
}

export interface ShoppingItem {
  name: string;
  amount: number;
  unit: string;
  category: ShoppingCategory;
  /** Meals this item supports, for the UI tooltip. */
  usedIn: string[];
}

export interface MealPlan {
  generatedAt: string;
  days: DayPlan[];
  shoppingList: ShoppingItem[];
  notes: string | null;
}

export interface GeneratePlanRequest {
  preferences: string;
  pantry: string[];
  servingsPerMeal: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface GeneratePlanResponse {
  plan: MealPlan;
  cost: number;
  usage: TokenUsage;
}
