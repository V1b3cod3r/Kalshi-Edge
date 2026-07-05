"use client";

import { SourceBadge } from "./SourceBadge";
import { formatRelative } from "@/lib/time";
import type { SummarizedArticle } from "@/lib/types";

interface ArticleCardProps {
  article: SummarizedArticle;
  read: boolean;
  onOpen: (link: string) => void;
}

export function ArticleCard({ article, read, onOpen }: ArticleCardProps) {
  const age = formatRelative(article.publishedAt);
  return (
    <article
      className={`rounded-2xl bg-surface shadow-card p-6 sm:p-7 transition-opacity ${
        read ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-3.5 flex-wrap">
        <SourceBadge source={article.source} />
        {article.matchedInterest && (
          <span className="text-[12px] font-medium tracking-tight text-ink-muted truncate">
            {article.matchedInterest}
          </span>
        )}
        {age && (
          <span className="ml-auto text-[12px] tabular-nums text-ink-faint">{age}</span>
        )}
      </div>
      <h2 className="text-[20px] sm:text-[22px] font-semibold leading-[1.28] tracking-[-0.02em] text-ink">
        {article.title}
      </h2>
      <p className="mt-2.5 text-[15px] leading-[1.65] text-ink-soft">
        {article.summary}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <a
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onOpen(article.link)}
          className="pressable inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline"
        >
          Read on {article.sourceName}
          <span aria-hidden>→</span>
        </a>
        {read && (
          <span className="text-[12px] text-ink-faint">Read</span>
        )}
      </div>
      {article.related.length > 0 && (
        <div className="mt-4 pt-4 border-t border-surface-line">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-faint mb-2.5">
            Also covered by
          </p>
          <ul className="space-y-2">
            {article.related.map((r) => (
              <li key={r.link} className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium text-ink-muted shrink-0">
                  {r.sourceName}
                </span>
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onOpen(r.link)}
                  className="pressable min-w-0 flex-1 text-[13px] text-ink-soft hover:text-accent hover:underline truncate"
                  title={r.title}
                >
                  {r.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
