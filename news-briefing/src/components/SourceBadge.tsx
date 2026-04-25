import type { SourceId } from "@/lib/types";

const COLORS: Record<SourceId, string> = {
  wsj: "bg-[#0a0a0a] text-white",
  ft: "bg-[#fff1e5] text-[#33302e] border border-[#e6d9c8]",
  economist: "bg-[#e3120b] text-white",
};

const LABELS: Record<SourceId, string> = {
  wsj: "WSJ",
  ft: "FT",
  economist: "Economist",
};

export function SourceBadge({ source }: { source: SourceId }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${COLORS[source]}`}
    >
      {LABELS[source]}
    </span>
  );
}
