export function PlanSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-surface shadow-card p-6">
          <div className="h-4 w-24 rounded bg-surface-tint" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full rounded bg-surface-tint" />
            <div className="h-3 w-5/6 rounded bg-surface-tint" />
            <div className="h-3 w-2/3 rounded bg-surface-tint" />
          </div>
        </div>
      ))}
    </div>
  );
}
