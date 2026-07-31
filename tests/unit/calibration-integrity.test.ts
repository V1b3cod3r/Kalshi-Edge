import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Phase 1 of the strategy plan: the measurement layer. These lock down the
// three flaws that made "does Claude beat the market?" unanswerable:
//   1. Selection bias — only edge-clearing predictions were logged.
//   2. Handicapped baseline — the market was scored at its ASK, not midpoint.
//   3. Wrong metric — Brier can improve while losing money.

let tmpDir: string

function seedPredictions(rows: any[]) {
  mkdirSync(path.join(tmpDir, 'data'), { recursive: true })
  writeFileSync(path.join(tmpDir, 'data', 'predictions.json'), JSON.stringify(rows, null, 2))
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-calib-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const base = {
  market_title: 'M', category: 'Other/General', source: 'scanner' as const,
  created_at: new Date().toISOString(),
}

describe('market Brier is scored at the MIDPOINT, not the ask', () => {
  it('uses (bid+ask)/2 when a two-sided quote was captured', async () => {
    // Market quoted 40/60. Midpoint = 0.50. Outcome YES.
    // Midpoint Brier = (0.50-1)^2 = 0.25. Ask-priced Brier would be
    // (0.60-1)^2 = 0.16 — i.e. the ask FLATTERS the market here, and in the
    // opposite direction it flatters Claude. Either way it isn't the fair price.
    seedPredictions([
      {
        ...base, id: 'p1', ticker: 'T1', predicted_probability: 0.9,
        direction: 'YES', outcome: 'YES', edge_pct: 5,
        market_price: 0.60, market_yes_bid: 0.40, market_yes_ask: 0.60,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const stats = getCalibrationStats()
    expect(stats.market_brier).toBeCloseTo(0.25, 4)
    expect(stats.market_brier_midpoint_samples).toBe(1)
  })

  it('falls back to the ask for legacy rows and flags the bias in the verdict', async () => {
    // 10 legacy rows (no bid/ask) so the comparison string is actually produced.
    seedPredictions(
      Array.from({ length: 10 }, (_, i) => ({
        ...base, id: `p${i}`, ticker: `T${i}`, predicted_probability: 0.9,
        direction: 'YES', outcome: 'YES', edge_pct: 5, market_price: 0.60,
      }))
    )
    const { getCalibrationStats } = await import('@/lib/storage')
    const stats = getCalibrationStats()
    expect(stats.market_brier_midpoint_samples).toBe(0)
    expect(stats.claude_vs_market).toMatch(/NOTE: scored against the ask/)
  })
})

describe('Claude vs market compares the SAME rows (apples to apples)', () => {
  it('scores Claude only on rows the market could also be scored on', async () => {
    // 10 rows WITH a quote where Claude is poor (0.5 vs outcome YES → 0.25),
    // plus 5 rows WITHOUT a quote where Claude is perfect (1.0 → 0.0).
    // If Claude were scored over all 15 while the market is scored over 10,
    // Claude's number would be flattered by rows the market never faced.
    const withQuote = Array.from({ length: 10 }, (_, i) => ({
      ...base, id: `q${i}`, ticker: `Q${i}`, predicted_probability: 0.5,
      direction: 'YES', outcome: 'YES', edge_pct: 5,
      market_price: 0.5, market_yes_bid: 0.45, market_yes_ask: 0.55,
    }))
    const withoutQuote = Array.from({ length: 5 }, (_, i) => ({
      ...base, id: `n${i}`, ticker: `N${i}`, predicted_probability: 1.0,
      direction: 'YES', outcome: 'YES', edge_pct: 5, market_price: 0.5,
    }))
    seedPredictions([...withQuote, ...withoutQuote])

    const { getCalibrationStats } = await import('@/lib/storage')
    const stats = getCalibrationStats()

    // Comparison is on the 10 quoted rows only → Claude's Brier there is 0.25,
    // identical to the market's, so the market must NOT lose.
    expect(stats.claude_vs_market).toContain('n=10')
    expect(stats.claude_vs_market).toMatch(/^Market beats Claude/)
    // Whole-sample Brier still reflects all 15 rows and is therefore better —
    // proving the comparison is NOT just reading claude_brier.
    expect(stats.claude_brier).toBeLessThan(0.25)
  })
})

describe('realized ROI by claimed-edge bucket', () => {
  it('computes return per dollar risked from entry price and outcome', async () => {
    // Two resolved trades in the 4-6% bucket, entry 50¢:
    //   win  → payoff +0.50, cost 0.50
    //   loss → payoff -0.50, cost 0.50
    // ROI = 0 / 1.00 = 0%. Hit rate 50%.
    seedPredictions([
      {
        ...base, id: 'w', ticker: 'W', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
      },
      {
        ...base, id: 'l', ticker: 'L', predicted_probability: 0.7, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    expect(bucket.resolved).toBe(2)
    expect(bucket.hit_rate).toBeCloseTo(0.5, 3)
    expect(bucket.realized_roi_pct).toBeCloseTo(0, 3)
  })

  it('prices a NO entry at (1 - yes ask), not at the yes price', async () => {
    // NO bet on a market with YES ask 0.80 → NO entry costs 0.20.
    // Outcome NO (we win): payoff +0.80 on cost 0.20 → ROI +400%.
    seedPredictions([
      {
        ...base, id: 'no1', ticker: 'NO1', predicted_probability: 0.1, direction: 'NO',
        outcome: 'NO', edge_pct: 12, market_price: 0.8, actionable: true,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '10%+')!
    expect(bucket.realized_roi_pct).toBeCloseTo(400, 0)
  })

  it('excludes non-actionable rows from ROI but still counts them for calibration', async () => {
    // A logged-but-never-tradeable row must not pollute trading returns.
    seedPredictions([
      {
        ...base, id: 'a', ticker: 'A', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
      },
      {
        ...base, id: 'b', ticker: 'B', predicted_probability: 0.7, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: false,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const stats = getCalibrationStats()
    const bucket = stats.by_edge_bucket.find((b) => b.bucket === '4-6%')!
    // Only the actionable winner counts toward ROI → +100%, not 0%.
    expect(bucket.resolved).toBe(1)
    expect(bucket.realized_roi_pct).toBeCloseTo(100, 3)
    // But BOTH rows still count toward overall calibration.
    expect(stats.resolved_predictions).toBe(2)
  })

  it('treats legacy rows (no actionable field) as actionable', async () => {
    seedPredictions([
      {
        ...base, id: 'legacy', ticker: 'LEG', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    expect(bucket.resolved).toBe(1)
  })
})

describe('realized ROI by ORIGIN strategy (strategy registry)', () => {
  it('groups predictions by strategy tag and computes ROI/hit-rate/brier per group', async () => {
    seedPredictions([
      // dated-favorites: one win at 80c entry -> payoff +0.20, cost 0.80 -> ROI +25%
      {
        ...base, id: 'df1', ticker: 'DF1', predicted_probability: 0.9, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.8, execution_price: 0.8, actionable: true,
        strategy: 'dated-favorites',
      },
      // llm-divergence: one loss at 50c entry -> payoff -0.50, cost 0.50 -> ROI -100%
      {
        ...base, id: 'll1', ticker: 'LL1', predicted_probability: 0.7, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        strategy: 'llm-divergence',
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_strategy

    const df = by.find((s) => s.strategy === 'dated-favorites')!
    expect(df.count).toBe(1)
    expect(df.resolved).toBe(1)
    expect(df.hit_rate).toBeCloseTo(1, 3)
    expect(df.realized_roi_pct).toBeCloseTo(25, 1)

    const llm = by.find((s) => s.strategy === 'llm-divergence')!
    expect(llm.count).toBe(1)
    expect(llm.hit_rate).toBeCloseTo(0, 3)
    expect(llm.realized_roi_pct).toBeCloseTo(-100, 1)
  })

  it('groups legacy rows with no strategy field under llm-divergence — the only strategy that existed before the registry', async () => {
    seedPredictions([
      {
        ...base, id: 'legacy', ticker: 'LEG', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        // no strategy field at all
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_strategy
    expect(by.map((s) => s.strategy)).toEqual(['llm-divergence'])
    expect(by[0].count).toBe(1)
  })

  it('excludes non-actionable rows from strategy ROI, same as the edge-bucket breakdown', async () => {
    seedPredictions([
      {
        ...base, id: 'a', ticker: 'A', predicted_probability: 0.7, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: false,
        strategy: 'settlement-snipe',
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_strategy
    expect(by.find((s) => s.strategy === 'settlement-snipe')).toBeUndefined()
  })
})
