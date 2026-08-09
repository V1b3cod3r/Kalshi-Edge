"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadPantry,
  loadPreferences,
  loadServings,
  savePantry,
  savePreferences,
  saveServings,
} from "@/lib/storage";

export default function SettingsPage() {
  const router = useRouter();
  const [preferences, setPreferences] = useState("");
  const [pantryText, setPantryText] = useState("");
  const [servings, setServings] = useState(2);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPreferences(loadPreferences());
    setPantryText(loadPantry().join("\n"));
    setServings(loadServings());
    setHydrated(true);
  }, []);

  function save() {
    const pantry = pantryText
      .split("\n")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    savePreferences(preferences.trim());
    savePantry(pantry);
    saveServings(servings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!hydrated) return null;

  return (
    <main className="min-h-screen pb-16">
      <header className="container-narrow pt-10 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Settings
          </h1>
          <Link
            href="/"
            className="pressable rounded-full border border-surface-line bg-surface px-3 py-2 text-[14px] text-ink-soft hover:text-ink"
          >
            Back
          </Link>
        </div>
      </header>
      <div className="container-narrow space-y-6">
        <section className="rounded-2xl bg-surface shadow-card p-6">
          <h2 className="text-[16px] font-semibold text-ink">Dietary preferences</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Free-form. Examples: &quot;high protein, no shellfish, vegetarian dinners on
            Wednesdays&quot;. Treated as hard constraints.
          </p>
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            rows={4}
            className="mt-3 w-full rounded-xl border border-surface-line bg-surface-tint px-4 py-3 text-[14px] text-ink focus:outline-none focus:border-accent"
            placeholder="No pork. ~150g protein per day. Mediterranean-leaning."
          />
        </section>

        <section className="rounded-2xl bg-surface shadow-card p-6">
          <h2 className="text-[16px] font-semibold text-ink">Pantry</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            One ingredient per line — staples you already own. These are excluded from
            the shopping list.
          </p>
          <textarea
            value={pantryText}
            onChange={(e) => setPantryText(e.target.value)}
            rows={10}
            className="mt-3 w-full rounded-xl border border-surface-line bg-surface-tint px-4 py-3 text-[14px] text-ink focus:outline-none focus:border-accent font-mono"
            placeholder={"olive oil\nsalt\nblack pepper\ngarlic\nsoy sauce\nrice"}
          />
        </section>

        <section className="rounded-2xl bg-surface shadow-card p-6">
          <h2 className="text-[16px] font-semibold text-ink">Servings per meal</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            How many people each meal should feed.
          </p>
          <div className="mt-3 inline-flex items-center gap-3">
            <button
              type="button"
              onClick={() => setServings((v) => Math.max(1, v - 1))}
              className="pressable rounded-full border border-surface-line bg-surface w-8 h-8 text-[16px] text-ink-soft"
              aria-label="Decrease servings"
            >
              −
            </button>
            <span className="text-[18px] font-medium text-ink w-6 text-center tabular-nums">
              {servings}
            </span>
            <button
              type="button"
              onClick={() => setServings((v) => Math.min(8, v + 1))}
              className="pressable rounded-full border border-surface-line bg-surface w-8 h-8 text-[16px] text-ink-soft"
              aria-label="Increase servings"
            >
              +
            </button>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={save}
            className="pressable rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-white"
          >
            {saved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="pressable rounded-full border border-surface-line bg-surface px-4 py-2 text-[13px] text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
