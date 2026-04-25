"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <header className="container-narrow pt-10 pb-6 sm:pt-14 sm:pb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] uppercase tracking-[0.12em] text-ink-faint">
            {today}
          </p>
          <h1 className="mt-1 text-[34px] sm:text-[40px] font-semibold tracking-[-0.025em] text-ink">
            Briefing
          </h1>
          {subtitle && (
            <p className="mt-2 text-[15px] text-ink-muted">{subtitle}</p>
          )}
        </div>
        <Link
          href={pathname === "/settings" ? "/" : "/settings"}
          className="pressable mt-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card hover:text-ink"
          aria-label={pathname === "/settings" ? "Back to briefing" : "Settings"}
        >
          {pathname === "/settings" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
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
    </header>
  );
}
