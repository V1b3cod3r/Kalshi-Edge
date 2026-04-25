"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ArticleCard } from "@/components/ArticleCard";
import { ArticleSkeleton } from "@/components/Skeleton";
import { loadInterests } from "@/lib/interests";
import type { Briefing } from "@/lib/types";

export default function BriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const interests = loadInterests();
    if (interests.length === 0) {
      setEmpty(true);
      return;
    }
    fetch("/api/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interests }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: Briefing) => setBriefing(data))
      .catch((e: Error) => setError(e.message));
  }, []);

  const subtitle = briefing
    ? `${briefing.articles.length} stories matched to your interests`
    : empty
      ? "Add some interests to get started"
      : "Curating today's stories…";

  return (
    <main className="min-h-screen pb-16">
      <Header subtitle={subtitle} />
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
            <p className="font-medium text-ink">Couldn&apos;t load today&apos;s briefing.</p>
            <p className="mt-1 text-ink-muted">{error}</p>
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
