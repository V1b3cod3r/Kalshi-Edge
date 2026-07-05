export type Theme = "light" | "dark" | "system";

const KEY = "nb_theme_v1";
export const DEFAULT_THEME: Theme = "system";

export function loadTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const raw = window.localStorage.getItem(KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_THEME;
}

export function saveTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, theme);
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function isDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemPrefersDark();
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark(theme));
}

// Inline in <head> so the .dark class is set before first paint — otherwise
// a dark-mode user would see a flash of the light theme before hydration.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
