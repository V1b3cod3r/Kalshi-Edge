import type { SourceId } from "@/lib/types";

const COLORS: Record<SourceId, string> = {
  wsj: "bg-[#0a0a0a] text-white",
  ft: "bg-[#fff1e5] text-[#33302e] border border-[#e6d9c8]",
  economist: "bg-[#e3120b] text-white",
  reuters: "bg-[#fa6601] text-white",
  bloomberg: "bg-[#1a1a1a] text-[#ff9b00]",
  axios: "bg-[#0b1d3a] text-white",
  semafor: "bg-[#000] text-[#ffd700]",
  nyt: "bg-white text-[#121212] border border-[#121212]",
  politico: "bg-[#cf202f] text-white",
  fed: "bg-[#04304a] text-white",
};

const LABELS: Record<SourceId, string> = {
  wsj: "WSJ",
  ft: "FT",
  economist: "Economist",
  reuters: "Reuters",
  bloomberg: "Bloomberg",
  axios: "Axios",
  semafor: "Semafor",
  nyt: "NYT",
  politico: "Politico",
  fed: "Fed",
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
