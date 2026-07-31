import { describe, it, expect } from 'vitest'
import {
  SHRINK_MARKET,
  SHRINK_CLAUDE,
  KALSHI_FEE_COEF,
  MIN_EFFECTIVE_EDGE,
} from '@/lib/scan'

// Replicates the effective-edge post-processing in runScan (src/lib/scan.ts):
//   p_shrunk = SHRINK_MARKET × market_yes_ask + SHRINK_CLAUDE × p_claude
//   execution = yes_ask (YES) | no_ask (NO)
//   fee = KALSHI_FEE_COEF × execution × (1 − execution)
//   raw = p_shrunk − execution (YES) | (1 − p_shrunk) − execution (NO)
//   effective_edge_pct = (raw − fee) × 100, rounded to 2dp
// The integration suite (api-auto-scan) proves the pipeline emits exactly this
// number end-to-end; this file locks the formula and its constants.
function effectiveEdgePct(params: {
  direction: 'YES' | 'NO'
  yes_ask: number
  no_ask: number
  claude_estimate_pct: number
}): number {
  const { direction, yes_ask, no_ask, claude_estimate_pct } = params
  const p_claude = claude_estimate_pct / 100
  const p_shrunk = SHRINK_MARKET * yes_ask + SHRINK_CLAUDE * p_claude
  const execution_price = direction === 'YES' ? yes_ask : no_ask
  const fee = KALSHI_FEE_COEF * execution_price * (1 - execution_price)
  const raw_edge = direction === 'YES' ? p_shrunk - execution_price : (1 - p_shrunk) - execution_price
  return parseFloat(((raw_edge - fee) * 100).toFixed(2))
}

describe('edge constants', () => {
  it('exports the calibrated shrinkage weights', () => {
    expect(SHRINK_MARKET).toBe(0.6)
    expect(SHRINK_CLAUDE).toBe(0.4)
    // The blend is a weighted average — weights must sum to 1 or probabilities
    // leak out of [0, 1].
    expect(SHRINK_MARKET + SHRINK_CLAUDE).toBeCloseTo(1, 12)
  })

  it('exports the Kalshi fee coefficient 0.07', () => {
    expect(KALSHI_FEE_COEF).toBe(0.07)
  })

  it('exports MIN_EFFECTIVE_EDGE 0.12 (calibration floor, not a hopeful guess)', () => {
    // Set at the measured calibration floor: KalshiBench found Claude Opus
    // 4.5 — the best of 5 frontier models tested — has ECE 0.120 on
    // genuinely-unknown future Kalshi questions. A threshold below that is
    // mostly sampling the model's own calibration error, not real edge.
    expect(MIN_EFFECTIVE_EDGE).toBe(0.12)
  })
})

describe('effective edge formula — hand-computed examples', () => {
  it('YES at market 0.54 when Claude says 30% is deeply negative', () => {
    // p_shrunk = 0.6×0.54 + 0.4×0.30 = 0.444
    // fee = 0.07 × 0.54 × 0.46 = 0.017388
    // edge = (0.444 − 0.54 − 0.017388) × 100 = −11.34
    const edge = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.54,
      no_ask: 0.47,
      claude_estimate_pct: 30,
    })
    expect(edge).toBeCloseTo(-11.34, 2)
  })

  it('NO at no_ask 0.47 (market yes 0.54, Claude 30%) ≈ +6.86% [live-verified]', () => {
    // p_shrunk = 0.444; raw = (1 − 0.444) − 0.47 = 0.086
    // fee = 0.07 × 0.47 × 0.53 = 0.017437
    // edge = (0.086 − 0.017437) × 100 = 6.86
    const edge = effectiveEdgePct({
      direction: 'NO',
      yes_ask: 0.54,
      no_ask: 0.47,
      claude_estimate_pct: 30,
    })
    expect(edge).toBeCloseTo(6.86, 2)
  })

  it('YES at market 0.83 when Claude says 95% ≈ +3.81% [live-verified]', () => {
    // p_shrunk = 0.6×0.83 + 0.4×0.95 = 0.878; raw = 0.048
    // fee = 0.07 × 0.83 × 0.17 = 0.009877
    // edge = (0.048 − 0.009877) × 100 = 3.81
    const edge = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.83,
      no_ask: 0.18,
      claude_estimate_pct: 95,
    })
    expect(edge).toBeCloseTo(3.81, 2)
  })

  it('agreeing with the market always yields a negative edge (the fee)', () => {
    // Claude estimate == market price → p_shrunk == price → raw edge 0 on the
    // YES side, so effective edge = −fee. Anything else means the formula
    // manufactures edge out of thin air.
    const edge = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.5,
      no_ask: 0.52,
      claude_estimate_pct: 50,
    })
    expect(edge).toBeCloseTo(-0.07 * 0.5 * 0.5 * 100, 2) // −1.75
  })

  it('shrinkage anchors on the real quote: 60% market / 40% Claude', () => {
    // A wild Claude estimate (99% vs market 50%) is dampened to
    // 0.6×0.50 + 0.4×0.99 = 0.696 — not 0.99.
    const p_shrunk = SHRINK_MARKET * 0.5 + SHRINK_CLAUDE * 0.99
    expect(p_shrunk).toBeCloseTo(0.696, 6)
    // Effective YES edge = 0.696 − 0.5 − 0.0175 = 0.1785 → 17.85%
    const edge = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.5,
      no_ask: 0.52,
      claude_estimate_pct: 99,
    })
    expect(edge).toBeCloseTo(17.85, 2)
  })

  it('threshold semantics: edge must reach MIN_EFFECTIVE_EDGE × 100 to surface', () => {
    // runScan keeps opportunities with edge_pct >= min_effective_edge × 100.
    // Claude at 56% vs market 50¢: p_shrunk = 0.524, edge = 0.65% → screened.
    const below = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.5,
      no_ask: 0.52,
      claude_estimate_pct: 56,
    })
    expect(below).toBeLessThan(MIN_EFFECTIVE_EDGE * 100)

    // Claude at 85%: p_shrunk = 0.64, edge = 12.25% → passes the 12% floor.
    const above = effectiveEdgePct({
      direction: 'YES',
      yes_ask: 0.5,
      no_ask: 0.52,
      claude_estimate_pct: 85,
    })
    expect(above).toBeGreaterThanOrEqual(MIN_EFFECTIVE_EDGE * 100)
  })
})
