"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/Header";
import { ModelPicker } from "@/components/ModelPicker";
import { DEFAULT_INTERESTS, loadInterests, saveInterests } from "@/lib/interests";
import {
  DEFAULT_MODELS,
  loadModels,
  saveModels,
  type ModelChoice,
  type ModelId,
} from "@/lib/models";

export default function SettingsPage() {
  const router = useRouter();
  const [interests, setInterests] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODELS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setInterests(loadInterests());
    setModels(loadModels());
    setHydrated(true);
  }, []);

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (interests.includes(v)) {
      setDraft("");
      return;
    }
    const next = [...interests, v];
    setInterests(next);
    saveInterests(next);
    setDraft("");
  }

  function remove(i: number) {
    const next = interests.filter((_, idx) => idx !== i);
    setInterests(next);
    saveInterests(next);
  }

  function resetDefaults() {
    setInterests(DEFAULT_INTERESTS);
    saveInterests(DEFAULT_INTERESTS);
  }

  function setScoring(id: ModelId) {
    const next = { ...models, scoring: id };
    setModels(next);
    saveModels(next);
  }

  function setSummary(id: ModelId) {
    const next = { ...models, summary: id };
    setModels(next);
    saveModels(next);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="min-h-screen pb-16">
      <Header subtitle="Tune what makes it into your briefing." />
      <div className="container-narrow space-y-6">
        <section className="rounded-2xl bg-surface shadow-card p-6 sm:p-7">
          <label className="block text-[13px] font-medium text-ink-muted mb-2">
            Add an interest
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="e.g. central bank policy in Asia"
              className="flex-1 rounded-xl border border-surface-line bg-surface-tint px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={add}
              className="pressable rounded-xl bg-accent px-5 py-3 text-[15px] font-medium text-white"
            >
              Add
            </button>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            Be specific. &ldquo;US small-cap earnings&rdquo; works better than &ldquo;business news.&rdquo;
          </p>
        </section>

        <section className="rounded-2xl bg-surface shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-line">
            <h2 className="text-[14px] font-medium text-ink">Your interests</h2>
            <button
              type="button"
              onClick={resetDefaults}
              className="pressable text-[13px] text-ink-muted hover:text-ink"
            >
              Reset defaults
            </button>
          </div>
          {hydrated && interests.length === 0 ? (
            <p className="px-6 py-8 text-center text-[14px] text-ink-muted">
              No interests yet.
            </p>
          ) : (
            <ul>
              {interests.map((interest, i) => (
                <li
                  key={`${interest}-${i}`}
                  className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-surface-line last:border-b-0"
                >
                  <span className="text-[15px] text-ink">{interest}</span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="pressable text-[13px] text-ink-muted hover:text-[#d70015]"
                    aria-label={`Remove ${interest}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ModelPicker
          title="Relevance scoring"
          description="Ranks each candidate article against your interests. Cheap calls; Haiku is plenty here."
          costField="scoringCostHint"
          value={models.scoring}
          onChange={setScoring}
        />

        <ModelPicker
          title="Summaries"
          description="Writes the 6–8 sentence summary for each article. Sonnet writes more elegant prose; Haiku is 3× cheaper."
          costField="summaryCostHint"
          value={models.summary}
          onChange={setSummary}
        />

        <section className="rounded-2xl bg-surface shadow-card p-6 sm:p-7">
          <button
            type="button"
            onClick={logout}
            className="pressable text-[14px] text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </section>
      </div>
    </main>
  );
}
