"use client";

import Link from "next/link";

interface HeaderProps {
  subtitle?: string;
  onGenerate?: () => void;
  generating?: boolean;
  generateLabel?: string;
}

export function Header({ subtitle, onGenerate, generating, generateLabel = "Generate plan" }: HeaderProps) {
  return (
    <header className="container-narrow pt-10 pb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Meal Planner
          </h1>
          {subtitle && (
            <p className="mt-1 text-[14px] text-ink-muted">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="pressable rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
            >
              {generating ? "Planning…" : generateLabel}
            </button>
          )}
          <Link
            href="/settings"
            aria-label="Settings"
            className="pressable rounded-full border border-surface-line bg-surface px-3 py-2 text-[14px] text-ink-soft hover:text-ink"
          >
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}
