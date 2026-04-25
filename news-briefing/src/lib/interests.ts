export const DEFAULT_INTERESTS = [
  "prediction markets and Kalshi",
  "Federal Reserve policy and interest rates",
  "AI industry and frontier models",
  "geopolitics affecting global markets",
  "US equities and earnings",
  "energy and commodities",
];

const KEY = "nb_interests_v1";

export function loadInterests(): string[] {
  if (typeof window === "undefined") return DEFAULT_INTERESTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_INTERESTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_INTERESTS;
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return DEFAULT_INTERESTS;
  }
}

export function saveInterests(interests: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(interests));
}
