import { fetchMarkets } from '@/lib/kalshi'
import { normalizeMarket } from '@/lib/scan'
import { MarketInput } from '@/lib/types'

const MAX_PAGES = 25

// Lightweight open-market fetch for mechanical strategies that need to see
// the WHOLE market universe, not just the LLM scanner's top-N-by-volume
// slice (dated favorites and settlement sniping both care about markets the
// LLM scanner would never surface, since neither ranks by volume). Reuses
// scan.ts's normalizeMarket so quote parsing (ask/bid derivation, cent vs.
// dollar fields) is the SAME logic the LLM scanner uses — never re-derived
// here, which is exactly how the position-field and fee-coefficient bugs
// independently recurred across files earlier in this project.
//
// Deliberately simpler than runScan's pagination: best-effort, never throws.
// A mechanical strategy finding zero candidates this cycle is a normal,
// silent outcome — unlike an empty LLM scan, there's no threshold-tuning
// story worth surfacing for "no dated favorites this cycle."
export async function fetchOpenMarkets(maxDaysToResolution?: number): Promise<MarketInput[]> {
  const minCloseTs = Math.floor(Date.now() / 1000)
  const maxCloseTs = maxDaysToResolution ? minCloseTs + Math.ceil(maxDaysToResolution * 86400) : undefined
  const out: MarketInput[] = []
  const seen = new Set<string>()

  try {
    for (const statusParam of ['open', undefined] as const) {
      out.length = 0
      seen.clear()
      let cursor: string | null = null
      let gotAny = false
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchMarkets(null, {
          ...(statusParam ? { status: statusParam } : {}),
          min_close_ts: minCloseTs,
          ...(maxCloseTs ? { max_close_ts: maxCloseTs } : {}),
          limit: 200,
          ...(cursor ? { cursor } : {}),
        })
        for (const m of res.markets) {
          const key = m.ticker || m.id
          if (!key || seen.has(key)) continue
          seen.add(key)
          gotAny = true
          const normalized = normalizeMarket(m)
          if (normalized) out.push(normalized)
        }
        cursor = res.cursor
        if (!cursor) break
      }
      // 'open' is the documented status value; only fall back to an
      // unfiltered fetch if it genuinely returned nothing (Kalshi has been
      // inconsistent about accepted status values across deployments).
      if (gotAny) break
    }
  } catch {
    // best-effort — a mechanical strategy simply finds nothing this cycle
  }

  return out
}
