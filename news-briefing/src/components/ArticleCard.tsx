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
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <SourceBadge source={article.source} />
        {article.matchedInterest && (
          <span className="text-[12px] text-ink-muted truncate">
            {article.matchedInterest}
          </span>
        )}
        {age && (
          <span className="ml-auto text-[12px] text-ink-faint">{age}</span>
        )}
      </div>
      <h2 className="text-[19px] sm:text-[21px] font-semibold leading-snug tracking-[-0.01em] text-ink">
        {article.title}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-ink-soft">
        {article.summary}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
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
        <div className="mt-5 pt-4 border-t border-surface-line">
          <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint mb-2">
            Also covered by
          </p>
          <ul className="space-y-1.5">
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
                  className="pressable text-[13px] text-ink-soft hover:text-accent hover:underline truncate"
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
