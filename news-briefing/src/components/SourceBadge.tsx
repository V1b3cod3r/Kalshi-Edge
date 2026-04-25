import type { SourceId } from "@/lib/types";

const COLORS: Record<SourceId, string> = {
  wsj: "bg-[#0a0a0a] text-white",
  ft: "bg-[#fff1e5] text-[#33302e] border border-[#e6d9c8]",
  economist: "bg-[#e3120b] text-white",
  bloomberg: "bg-[#1a1a1a] text-[#ff9b00]",
  nyt: "bg-white text-[#121212] border border-[#121212]",
  politico: "bg-[#cf202f] text-white",
  fed: "bg-[#04304a] text-white",
  cnbc: "bg-[#0073e6] text-white",
  marketwatch: "bg-[#00ac4a] text-white",
  bbc: "bg-[#bb1919] text-white",
  guardian: "bg-[#052962] text-white",
  mr: "bg-[#3a3a3c] text-white",
};

const LABELS: Record<SourceId, string> = {
  wsj: "WSJ",
  ft: "FT",
  economist: "Economist",
  bloomberg: "Bloomberg",
  nyt: "NYT",
  politico: "Politico",
  fed: "Fed",
  cnbc: "CNBC",
  marketwatch: "MarketWatch",
  bbc: "BBC",
  guardian: "Guardian",
  mr: "MR",
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
