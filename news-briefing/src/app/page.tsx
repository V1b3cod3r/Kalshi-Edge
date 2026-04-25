"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ArticleCard } from "@/components/ArticleCard";
import { ArticleSkeleton } from "@/components/Skeleton";
import { loadInterests } from "@/lib/interests";
import { loadModels } from "@/lib/models";
import type { Briefing } from "@/lib/types";

function formatCost(dollars: number): string {
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(3)}`;
}

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [wasCached, setWasCached] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setError(null);
    setRefreshing(true);
    if (force) setBriefing(null);
    const interests = loadInterests();
    if (interests.length === 0) {
      setEmpty(true);
      setRefreshing(false);
      return;
    }
    setEmpty(false);
    const models = loadModels();
    const requestedAt = Date.now();
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests, refresh: force, models }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: Briefing = await res.json();
      const generatedAt = Date.parse(data.generatedAt);
      setWasCached(!Number.isNaN(generatedAt) && generatedAt < requestedAt - 5000);
      setBriefing(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  let subtitle: string | undefined;
  if (briefing) {
    const count = `${briefing.articles.length} stories matched to your interests`;
    const costLabel = wasCached
      ? "served from cache"
      : `this pull cost ${formatCost(briefing.cost.total)}`;
    subtitle = `${count} · ${costLabel}`;
  } else if (empty) {
    subtitle = "Add some interests to get started";
  } else if (refreshing) {
    subtitle = "Curating today's stories…";
  }

  return (
    <main className="min-h-screen pb-16">
      <Header
        subtitle={subtitle}
        onRefresh={empty ? undefined : () => load(true)}
        refreshing={refreshing}
      />
      <div className="container-narrow">
        {empty ? (
          <div className="rounded-2xl bg-surface shadow-card p-8 text-center">
            <p className="text-[15px] text-ink-soft">
              You haven&apos;t set any interests yet.
            </p>
            <Link
              href="/settings"
              className="pressable mt-4 inline-flex items-center justify-center rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-white"
            >
              Set interests
            </Link>
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-surface shadow-card p-6 text-[14px] text-ink-soft">
            <p className="font-medium text-ink">
              Couldn&apos;t load today&apos;s briefing.
            </p>
            <p className="mt-1 text-ink-muted">{error}</p>
            <button
              type="button"
              onClick={() => load(true)}
              className="pressable mt-4 inline-flex items-center justify-center rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-white"
            >
              Try again
            </button>
          </div>
        ) : !briefing ? (
          <div className="space-y-4">
            <ArticleSkeleton />
            <ArticleSkeleton />
            <ArticleSkeleton />
          </div>
        ) : briefing.articles.length === 0 ? (
          <div className="rounded-2xl bg-surface shadow-card p-8 text-center text-[15px] text-ink-soft">
            Nothing matched your interests today. Check back later, or
            <Link href="/settings" className="ml-1 text-accent hover:underline">
              broaden your interests
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-4">
            {briefing.articles.map((a, i) => (
              <ArticleCard key={`${a.link}-${i}`} article={a} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
