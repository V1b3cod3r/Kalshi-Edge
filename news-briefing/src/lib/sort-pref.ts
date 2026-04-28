export type SortMode = "relevance" | "recency";

const KEY = "nb_sort_v1";
export const DEFAULT_SORT: SortMode = "relevance";

export function loadSort(): SortMode {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const raw = window.localStorage.getItem(KEY);
  return raw === "recency" || raw === "relevance" ? raw : DEFAULT_SORT;
}

export function saveSort(mode: SortMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, mode);
}
