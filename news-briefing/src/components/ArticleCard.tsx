import { SourceBadge } from "./SourceBadge";
import type { SummarizedArticle } from "@/lib/types";

export function ArticleCard({ article }: { article: SummarizedArticle }) {
  return (
    <article className="rounded-2xl bg-surface shadow-card p-6 sm:p-7">
      <div className="flex items-center gap-3 mb-3">
        <SourceBadge source={article.source} />
        {article.matchedInterest && (
          <span className="text-[12px] text-ink-muted truncate">
            {article.matchedInterest}
          </span>
        )}
      </div>
      <h2 className="text-[19px] sm:text-[21px] font-semibold leading-snug tracking-[-0.01em] text-ink">
        {article.title}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-ink-soft">
        {article.summary}
      </p>
      <div className="mt-5">
        <a
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="pressable inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline"
        >
          Read on {article.sourceName}
          <span aria-hidden>→</span>
        </a>
      </div>
    </article>
  );
}
