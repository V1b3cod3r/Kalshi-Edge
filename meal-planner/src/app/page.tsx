"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { DayCard } from "@/components/MealCard";
import { ShoppingList } from "@/components/ShoppingList";
import { PlanSkeleton } from "@/components/Skeleton";
import {
  loadLastPlan,
  loadPantry,
  loadPreferences,
  loadServings,
  saveLastPlan,
} from "@/lib/storage";
import type { GeneratePlanResponse, MealPlan } from "@/lib/types";

function formatCost(dollars: number): string {
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(3)}`;
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PlannerPage() {
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPlan(loadLastPlan());
    setHydrated(true);
  }, []);

  const generate = useCallback(async () => {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: loadPreferences(),
          pantry: loadPantry(),
          servingsPerMeal: loadServings(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `request failed (${res.status})`);
      }
      const data: GeneratePlanResponse = await res.json();
      setPlan(data.plan);
      setLastCost(data.cost);
      saveLastPlan(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setGenerating(false);
    }
  }, []);

  let subtitle: string | undefined;
  if (generating) {
    subtitle = "Building your week…";
  } else if (plan) {
    const when = formatGeneratedAt(plan.generatedAt);
    const cost = lastCost !== null ? ` · cost ${formatCost(lastCost)}` : "";
    subtitle = when ? `Generated ${when}${cost}` : undefined;
  }

  return (
    <main className="min-h-screen pb-16">
      <Header
        subtitle={subtitle}
        onGenerate={generate}
        generating={generating}
        generateLabel={plan ? "Regenerate" : "Generate plan"}
      />
      <div className="container-narrow space-y-6">
        {!hydrated ? null : error ? (
          <div className="rounded-2xl bg-surface shadow-card p-6 text-[14px]">
            <p className="font-medium text-ink">Couldn&apos;t generate a plan.</p>
            <p className="mt-1 text-ink-muted">{error}</p>
            <button
              type="button"
              onClick={generate}
              className="pressable mt-4 inline-flex items-center justify-center rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-white"
            >
              Try again
            </button>
          </div>
        ) : generating ? (
          <PlanSkeleton />
        ) : !plan ? (
          <EmptyState />
        ) : (
          <>
            {plan.notes && (
              <p className="px-1 text-[14px] text-ink-soft">{plan.notes}</p>
            )}
            <ShoppingList items={plan.shoppingList} />
            <div className="space-y-4">
              {plan.days.map((d, i) => (
                <DayCard key={`${d.day}-${i}`} day={d} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-surface shadow-card p-8 text-center">
      <p className="text-[15px] text-ink-soft">
        Set your dietary preferences and pantry, then generate this week&apos;s plan.
      </p>
      <Link
        href="/settings"
        className="pressable mt-4 inline-flex items-center justify-center rounded-full border border-surface-line bg-surface px-5 py-2 text-[14px] font-medium text-ink-soft hover:text-ink"
      >
        Open settings
      </Link>
    </div>
  );
}
