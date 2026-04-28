const KEY = "nb_read_v1";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface ReadEntry {
  link: string;
  at: number;
}

function load(): ReadEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter(
      (e): e is ReadEntry =>
        e && typeof e.link === "string" && typeof e.at === "number" && e.at > cutoff,
    );
  } catch {
    return [];
  }
}

function save(entries: ReadEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(entries));
}

export function loadReadSet(): Set<string> {
  return new Set(load().map((e) => e.link));
}

export function markRead(link: string): void {
  const entries = load();
  if (entries.some((e) => e.link === link)) return;
  entries.push({ link, at: Date.now() });
  save(entries);
}
