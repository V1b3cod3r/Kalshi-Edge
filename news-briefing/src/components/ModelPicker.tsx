"use client";

import { MODELS, type ModelId } from "@/lib/models";

interface ModelPickerProps {
  title: string;
  description: string;
  costField: "scoringCostHint" | "summaryCostHint";
  value: ModelId;
  onChange: (id: ModelId) => void;
}

export function ModelPicker({
  title,
  description,
  costField,
  value,
  onChange,
}: ModelPickerProps) {
  return (
    <section className="rounded-2xl bg-surface shadow-card overflow-hidden">
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-[14px] font-medium text-ink">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{description}</p>
      </div>
      <ul>
        {MODELS.map((m) => {
          const selected = m.id === value;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onChange(m.id)}
                className="pressable w-full flex items-start justify-between gap-4 px-6 py-3.5 text-left border-t border-surface-line hover:bg-surface-tint"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-medium text-ink">
                      {m.name}
                    </span>
                    <span className="text-[12px] text-ink-faint">
                      {m[costField]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-muted">{m.blurb}</p>
                </div>
                <span
                  aria-hidden
                  className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    selected ? "bg-accent text-white" : "border border-surface-line"
                  }`}
                >
                  {selected && (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path
                        d="M2 5.5L4.5 8L9 3"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
