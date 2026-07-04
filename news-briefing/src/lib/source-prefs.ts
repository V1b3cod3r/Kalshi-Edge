import { SOURCE_LIST } from "./sources";
import type { SourceId } from "./types";

const KEY = "nb_sources_v1";

function allSourceIds(): SourceId[] {
  return SOURCE_LIST.map((s) => s.id);
}

export function loadEnabledSources(): SourceId[] {
  if (typeof window === "undefined") return allSourceIds();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return allSourceIds();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return allSourceIds();
    const valid = new Set(allSourceIds());
    return parsed.filter((id): id is SourceId => valid.has(id));
  } catch {
    return allSourceIds();
  }
}

export function saveEnabledSources(ids: SourceId[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ids));
}
