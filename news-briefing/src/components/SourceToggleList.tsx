"use client";

import { SourceBadge } from "./SourceBadge";
import type { SourceInfo } from "@/lib/sources";
import type { SourceId } from "@/lib/types";

interface SourceToggleListProps {
  sources: SourceInfo[];
  enabled: Set<SourceId>;
  onToggle: (id: SourceId) => void;
}

export function SourceToggleList({ sources, enabled, onToggle }: SourceToggleListProps) {
  return (
    <ul>
      {sources.map((s) => {
        const on = enabled.has(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => onToggle(s.id)}
              className="pressable w-full flex items-center justify-between gap-4 px-6 py-3.5 text-left border-t border-surface-line first:border-t-0 hover:bg-surface-tint"
            >
              <div className="flex items-center gap-3 min-w-0">
                <SourceBadge source={s.id} />
                <span className="truncate text-[14px] text-ink">{s.name}</span>
              </div>
              <span
                aria-hidden
                className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  on ? "bg-accent" : "bg-surface-line"
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    on ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
