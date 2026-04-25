export function ArticleSkeleton() {
  return (
    <div className="rounded-2xl bg-surface shadow-card p-6 sm:p-7 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-5 w-12 rounded-full bg-surface-line" />
        <div className="h-3 w-32 rounded bg-surface-line" />
      </div>
      <div className="h-5 w-5/6 rounded bg-surface-line" />
      <div className="mt-2 h-5 w-3/4 rounded bg-surface-line" />
      <div className="mt-5 space-y-2">
        <div className="h-3 w-full rounded bg-surface-line" />
        <div className="h-3 w-full rounded bg-surface-line" />
        <div className="h-3 w-11/12 rounded bg-surface-line" />
        <div className="h-3 w-9/12 rounded bg-surface-line" />
      </div>
    </div>
  );
}
