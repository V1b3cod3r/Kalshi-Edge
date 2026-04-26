"use client";

import type { SortMode } from "@/lib/sort-pref";

interface SortToggleProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

const OPTIONS: { id: SortMode; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "recency", label: "Recency" },
];

export function SortToggle({ value, onChange }: SortToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Sort articles"
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
            className={`pressable rounded-full px-3 py-1 font-medium transition-colors ${
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
