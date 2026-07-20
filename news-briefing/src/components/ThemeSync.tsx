"use client";

import { useEffect } from "react";
import { applyTheme, loadTheme } from "@/lib/theme";

// Mounted once in the root layout. The inline head script (see layout.tsx)
// already sets the class before first paint; this only handles the case
// where the OS theme changes while the app is open and the user is on
// "system" mode.
export function ThemeSync() {
  useEffect(() => {
    if (loadTheme() !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return null;
}
