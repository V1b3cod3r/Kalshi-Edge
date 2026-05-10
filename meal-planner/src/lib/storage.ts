const PREFS_KEY = "mp:preferences";
const PANTRY_KEY = "mp:pantry";
const SERVINGS_KEY = "mp:servings";
const PLAN_KEY = "mp:last-plan";

import type { MealPlan } from "./types";

export function loadPreferences(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PREFS_KEY) ?? "";
}

export function savePreferences(value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFS_KEY, value);
}

export function loadPantry(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(PANTRY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

export function savePantry(items: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PANTRY_KEY, JSON.stringify(items));
}

export function loadServings(): number {
  if (typeof window === "undefined") return 2;
  const raw = window.localStorage.getItem(SERVINGS_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 8 ? Math.round(n) : 2;
}

export function saveServings(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SERVINGS_KEY, String(value));
}

export function loadLastPlan(): MealPlan | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PLAN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MealPlan;
  } catch {
    return null;
  }
}

export function saveLastPlan(plan: MealPlan): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}

export function clearLastPlan(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PLAN_KEY);
}
