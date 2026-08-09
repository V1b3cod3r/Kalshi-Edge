"use client";

import { useState } from "react";
import type { DayPlan, Meal } from "@/lib/types";
import { formatAmount } from "@/lib/amazon";

const SLOT_LABEL: Record<Meal["slot"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export function DayCard({ day }: { day: DayPlan }) {
  return (
    <section className="rounded-2xl bg-surface shadow-card p-6">
      <h2 className="text-[13px] uppercase tracking-[0.12em] text-ink-faint">
        {day.day}
      </h2>
      <div className="mt-4 space-y-4">
        {day.meals.map((m, i) => (
          <MealRow key={`${day.day}-${m.slot}-${i}`} meal={m} />
        ))}
      </div>
    </section>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pressable w-full text-left"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[12px] font-medium uppercase tracking-wider text-ink-muted w-[72px] shrink-0">
            {SLOT_LABEL[meal.slot]}
          </span>
          <span className="text-[15px] font-medium text-ink">{meal.title}</span>
          <span className="ml-auto text-[12px] text-ink-faint">
            {open ? "Hide" : "Show"} ingredients
          </span>
        </div>
        <p className="mt-1 ml-[84px] text-[14px] text-ink-soft">{meal.description}</p>
      </button>
      {open && (
        <ul className="mt-2 ml-[84px] space-y-0.5 text-[13px] text-ink-muted">
          {meal.ingredients.map((ing, i) => (
            <li key={i}>
              {formatAmount(ing.amount, ing.unit)} {ing.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
