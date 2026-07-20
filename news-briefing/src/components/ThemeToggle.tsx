"use client";

import type { Theme } from "@/lib/theme";

interface ThemeToggleProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

const OPTIONS: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Appearance"
      className="inline-flex rounded-full bg-surface shadow-card p-1 text-[12px]"
    >
      {OPTIONS.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.id)}
            className={`pressable rounded-full px-3.5 py-1.5 font-medium transition-colors ${
              selected ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
