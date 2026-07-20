"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface HeaderProps {
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Header({ subtitle, onRefresh, refreshing }: HeaderProps) {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const onSettings = pathname === "/settings";
  return (
    <header className="container-narrow pt-8 pb-5 sm:pt-12 sm:pb-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium uppercase tracking-[0.1em] text-ink-faint">
            {today}
          </p>
          <h1 className="mt-1.5 text-[32px] sm:text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
            Briefing
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-[14px] leading-[1.4] text-ink-muted">{subtitle}</p>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {onRefresh && !onSettings && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh briefing"
              className="pressable inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card hover:text-ink disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className={refreshing ? "animate-spin" : ""}
              >
                <path
                  d="M13.5 8a5.5 5.5 0 1 1-1.7-3.96"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M14 2.5V5.5H11"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <Link
            href={onSettings ? "/" : "/settings"}
            className="pressable inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card hover:text-ink"
            aria-label={onSettings ? "Back to briefing" : "Settings"}
          >
            {onSettings ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 12L6 8l4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
