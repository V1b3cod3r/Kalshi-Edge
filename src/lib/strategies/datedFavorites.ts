import { AutopilotSettings } from '@/lib/types'
import { kalshiFeeCoef } from '@/lib/scan'
import { fetchOpenMarkets } from './marketFetch'
import { StrategyOpportunity } from './types'

// ---------------------------------------------------------------------------
// Strategy: Dated Favorites (see docs/STRATEGY_EXPANSION_PLAN.md, Strategy 2)
//
// Mechanical, no LLM call: buy whichever side is priced as a moderate-to-
// strong favorite, dated a few weeks out, and hold to resolution. Backed by
// two independent findings — a 292M-trade study found market calibration
// degrades with horizon (favorites priced ~70-75c a month out tend to be
// underpriced), and Kalshi's own transaction data shows contracts above 50c
// earn small positive average returns while sub-10c longshots lose most of
// what's invested. Both point the same direction.
//
// The "true probability" used for Kelly sizing is a DELIBERATELY
// CONSERVATIVE model, not a literal transcription of the cited research
// slope (~1.32) — see DATED_FAVORITES_MAX_SLOPE below. Re-tune from your own
// backtest once you have one; do not raise this toward the cited number on
// a hunch.
// ---------------------------------------------------------------------------

// Extremization slope at the far edge of the horizon window. 1.0 = no
// correction (price taken at face value). The cited research figure was
// ~1.32 at >1 month; this ships well under that, and ramps linearly from
// 1.0 at day 0 to this value at the window's max-days edge.
export const DATED_FAVORITES_MAX_SLOPE = 1.15

function logit(p: number): number {
  const c = Math.min(0.99, Math.max(0.01, p))
  return Math.log(c / (1 - c))
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// Exported for unit testing — this is the one piece of real "model" in this
// strategy and it's the part most worth locking down and re-verifying.
export function horizonCorrectedProb(price: number, days: number, maxDays: number, maxSlope = DATED_FAVORITES_MAX_SLOPE): number {
  if (maxDays <= 0) return Math.min(0.99, Math.max(0.01, price))
  const t = Math.max(0, Math.min(1, days / maxDays))
  const slope = 1 + (maxSlope - 1) * t
  return sigmoid(logit(price) * slope)
}

export async function datedFavoritesOpportunities(ap: AutopilotSettings): Promise<StrategyOpportunity[]> {
  const minPrice = (ap.dated_favorites_min_price_cents ?? 65) / 100
  const maxPrice = (ap.dated_favorites_max_price_cents ?? 90) / 100
  const minDays = ap.dated_favorites_min_days ?? 14
  const maxDays = ap.dated_favorites_max_days ?? 56
  const minVolumeUsd = ap.dated_favorites_min_volume_usd ?? 500

  const markets = await fetchOpenMarkets(maxDays)
  const now = Date.now()
  const out: StrategyOpportunity[] = []

  for (const m of markets) {
    if (!m.id || !m.resolution_date) continue
    const resolveTs = Date.parse(m.resolution_date)
    if (!Number.isFinite(resolveTs)) continue
    const days = (resolveTs - now) / (1000 * 60 * 60 * 24)
    if (days < minDays || days > maxDays) continue

    // Whichever side's ask falls in the favorite band — check YES first,
    // then NO. In the rare case both qualify (thin/crossed book), YES wins
    // by check order; this is an edge case, not a modeled preference.
    let direction: 'YES' | 'NO' | null = null
    let price = 0
    if (m.yes_price >= minPrice && m.yes_price <= maxPrice) {
      direction = 'YES'
      price = m.yes_price
    } else if (m.no_price >= minPrice && m.no_price <= maxPrice) {
      direction = 'NO'
      price = m.no_price
    }
    if (!direction) continue

    const pFavoriteWins = horizonCorrectedProb(price, days, maxDays)
    // p_shrunk is always P(YES) — convert if the favorite side is NO.
    const p_shrunk = direction === 'YES' ? pFavoriteWins : 1 - pFavoriteWins

    const fee = kalshiFeeCoef(m.id) * price * (1 - price)
    const raw_edge = direction === 'YES' ? p_shrunk - price : (1 - p_shrunk) - price
    const edge_pct = parseFloat(((raw_edge - fee) * 100).toFixed(2))

    const annualized_edge_pct = parseFloat(((edge_pct * 365) / Math.max(1, days)).toFixed(1))

    // Liquidity floor: this rule reports HIGH confidence unconditionally
    // (see below) regardless of how thin the book is — without a floor, a
    // single-quote market draws the SAME (smallest) Kelly haircut as a
    // liquid one. Downgrade to MEDIUM rather than excluding outright: real
    // risk control stays the Kelly haircut/edge threshold/exposure caps, not
    // a hard cutoff that would throw away a genuinely-good thin opportunity.
    const thin = (m.volume_24h ?? 0) < minVolumeUsd

    out.push({
      strategy: 'dated-favorites',
      ticker: m.id,
      title: m.title,
      direction,
      execution_price: price,
      edge_pct,
      p_shrunk,
      // Deterministic price×horizon rule backed by large-sample research, not
      // a single model's self-reported certainty — reported HIGH so it can
      // actually clear the default min_confidence gate once a user opts in.
      // Real risk control here is the Kelly haircut, edge threshold, and
      // exposure caps below, all still applied exactly as for any strategy.
      // Downgraded to MEDIUM below the liquidity floor (see `thin` above).
      confidence: thin ? 'MEDIUM' : 'HIGH',
      category: m.category ?? 'Other/General',
      resolution_date: m.resolution_date ?? null,
      rationale: `Favorite ${direction} @ ${(price * 100).toFixed(0)}¢, ${days.toFixed(0)}d to resolution — horizon-corrected P(${direction})≈${(pFavoriteWins * 100).toFixed(1)}% (slope-capped at ${DATED_FAVORITES_MAX_SLOPE}x)` +
        (thin ? ` — thin market ($${(m.volume_24h ?? 0).toFixed(0)} 24h volume, below $${minVolumeUsd} floor), confidence downgraded` : ''),
      days_to_resolution: Math.max(1, days),
      annualized_edge_pct,
    })
  }

  return out
}
