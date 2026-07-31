import { AutopilotSettings } from '@/lib/types'
import { kalshiFeeCoef } from '@/lib/scan'
import { TEMP_TICKER_CITY_CODES } from '@/lib/signals'
import { fetchOpenMarkets } from './marketFetch'
import { getTodaysObservedExtreme } from './weatherObservations'
import { StrategyOpportunity } from './types'

// ---------------------------------------------------------------------------
// Strategy: Settlement Sniping (see docs/STRATEGY_EXPANSION_PLAN.md, Strategy 1)
//
// Kalshi's daily temperature markets settle on an official climate report
// published hours after the day's extreme has already happened. Live NWS
// observations report that extreme in near-real-time. This buys markets
// where the outcome is (almost) already publicly known — no forecasting.
//
// Deliberately narrow scope, all fail-safe-skip:
//   - Only TEMP_TICKER_CITY_CODES cities (verified codes only, never guessed)
//   - Only a clean `T<number>` threshold ticker suffix
//   - Only the two MONOTONIC-SAFE combinations: an H (running high, can only
//     increase or hold through the day) market whose title says "above", or
//     an L (running low, can only decrease or hold) market whose title says
//     "below". The other two combinations (H+below, L+above) are NOT safe to
//     bet early — the extreme could still move the wrong way before close —
//     and are skipped entirely, not approximated.
//   - Direction is confirmed independently from the market TITLE, never
//     assumed from the ticker alone. Ambiguous or uncorroborated titles are
//     skipped. Getting this wrong would size aggressively into a confidently
//     WRONG trade — the worst failure mode a near-certainty strategy can have.
//   - Only fires once the observed extreme clears the strike by a safety
//     margin (default 2°F), and the resulting probability is capped well
//     below 1.0 — the official report can still differ from the preliminary
//     observation, which is exactly why the market isn't already at $1.
// ---------------------------------------------------------------------------

const ABOVE_RE = /\b(above|exceeds?|over|greater than|more than)\b|>/i
const BELOW_RE = /\b(below|under|less than|fewer than)\b|</i

// Exported for unit testing — direction must be independently corroborated
// by the title, never assumed from the ticker (see file header).
export function inferDirectionFromTitle(title: string): 'above' | 'below' | null {
  const hasAbove = ABOVE_RE.test(title)
  const hasBelow = BELOW_RE.test(title)
  if (hasAbove && !hasBelow) return 'above'
  if (hasBelow && !hasAbove) return 'below'
  return null // ambiguous or neither corroborates — fail safe
}

// Exported for unit testing — parses the verified KXTEMP<CITY><H|L> prefix.
export function parseTempTicker(ticker: string): { cityCode: string; kind: 'H' | 'L' } | null {
  const series = String(ticker).split('-')[0]
  const m = series.match(/^KXTEMP([A-Z]{3})([HL])$/)
  if (!m) return null
  return { cityCode: m[1], kind: m[2] as 'H' | 'L' }
}

// Exported for unit testing — the ticker's LAST dash segment as a plain
// numeric threshold (e.g. "T74.99" -> 74.99). Anything else (range buckets,
// unrecognized formats) returns null rather than a guess.
export function parseThresholdFromTicker(ticker: string): number | null {
  const parts = String(ticker).split('-')
  const last = parts[parts.length - 1]
  const m = last.match(/^T([\d.]+)$/i)
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) ? v : null
}

export async function settlementSnipeOpportunities(ap: AutopilotSettings): Promise<StrategyOpportunity[]> {
  const marginF = ap.settlement_snipe_margin_f ?? 2
  const probCap = Math.min(0.99, Math.max(0.5, (ap.settlement_snipe_max_confidence_pct ?? 95) / 100))

  // Only markets resolving very soon — this strategy only makes sense for
  // "today's" market. A 2-day cap gives comfortable margin without pulling in
  // markets this reasoning doesn't apply to.
  const markets = await fetchOpenMarkets(2)
  const out: StrategyOpportunity[] = []

  // Cache one live observation fetch per (city, kind) per cycle — several
  // strike markets on the same city/day would otherwise re-fetch identically.
  const obsCache = new Map<string, Awaited<ReturnType<typeof getTodaysObservedExtreme>>>()

  for (const m of markets) {
    if (!m.id) continue
    const parsed = parseTempTicker(m.id)
    if (!parsed || !TEMP_TICKER_CITY_CODES[parsed.cityCode]) continue

    const threshold = parseThresholdFromTicker(m.id)
    if (threshold == null) continue

    const direction = inferDirectionFromTitle(m.title)
    if (!direction) continue

    // Only the two monotonic-safe combinations — see file header.
    const safe = (parsed.kind === 'H' && direction === 'above') || (parsed.kind === 'L' && direction === 'below')
    if (!safe) continue

    const cacheKey = `${parsed.cityCode}:${parsed.kind}`
    if (!obsCache.has(cacheKey)) {
      obsCache.set(cacheKey, await getTodaysObservedExtreme(parsed.cityCode, parsed.kind))
    }
    const obs = obsCache.get(cacheKey)
    if (!obs) continue

    const margin = parsed.kind === 'H' ? obs.valueF - threshold : threshold - obs.valueF
    if (margin < marginF) continue

    // Gentle, explicitly-labeled ramp from the margin floor up to the cap —
    // more cushion earns modestly higher confidence, never above the cap.
    const p_shrunk = Math.min(probCap, 0.85 + Math.max(0, margin - marginF) * 0.02)

    const price = m.yes_price
    if (!(price > 0) || !(price < 1)) continue
    const fee = kalshiFeeCoef(m.id) * price * (1 - price)
    const edge_pct = parseFloat(((p_shrunk - price - fee) * 100).toFixed(2))

    out.push({
      strategy: 'settlement-snipe',
      ticker: m.id,
      title: m.title,
      direction: 'YES', // always YES — see file header, only monotonic-safe/already-true cases fire
      execution_price: price,
      edge_pct,
      p_shrunk,
      confidence: 'HIGH', // gated on the safety margin above; nothing below the bar is ever emitted
      category: m.category ?? 'Other/General',
      resolution_date: m.resolution_date ?? null,
      rationale: `${parsed.cityCode} today's ${parsed.kind === 'H' ? 'high' : 'low'} observed ${obs.valueF.toFixed(1)}°F ` +
        `(as of ${obs.asOfIso}), clears ${threshold}°F strike by ${margin.toFixed(1)}°F — capped P(YES)=${(p_shrunk * 100).toFixed(1)}%`,
    })
  }

  return out
}
