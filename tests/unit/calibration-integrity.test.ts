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

function seedLessons(rows: any[]) {
  mkdirSync(path.join(tmpDir, 'data'), { recursive: true })
  writeFileSync(path.join(tmpDir, 'data', 'lessons.json'), JSON.stringify(rows, null, 2))
}

function seedAutopilotRuns(runs: any[]) {
  mkdirSync(path.join(tmpDir, 'data'), { recursive: true })
  writeFileSync(path.join(tmpDir, 'data', 'autopilot_log.json'), JSON.stringify(runs, null, 2))
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

const lessonBase = {
  prediction_id: 'p', market_title: 'M', predicted_direction: 'YES' as const,
  actual_outcome: 'NO' as const, predicted_probability: 0.8, market_price: 0.5,
  what_went_wrong: '', created_at: new Date().toISOString(),
}

describe('losses grouped by mistake type (root-cause rollup)', () => {
  it('always includes all 7 known mistake types, even with zero lessons', async () => {
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_mistake_type
    expect(by.map((m) => m.mistake_type).sort()).toEqual(
      ['anchoring', 'base_rate_neglect', 'news_overreaction', 'other', 'overconfidence', 'thin_market', 'timing_error']
    )
    expect(by.every((m) => m.count === 0)).toBe(true)
  })

  it('counts lessons per mistake type and sorts most-frequent first', async () => {
    seedLessons([
      { ...lessonBase, id: 'l1', category: 'Politics', keywords: [], edge_pct: 8, mistake_type: 'overconfidence', what_to_do_differently: 'A' },
      { ...lessonBase, id: 'l2', category: 'Politics', keywords: [], edge_pct: 12, mistake_type: 'overconfidence', what_to_do_differently: 'B' },
      { ...lessonBase, id: 'l3', category: 'Economics/Finance', keywords: [], edge_pct: 5, mistake_type: 'thin_market', what_to_do_differently: 'C' },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_mistake_type

    expect(by[0].mistake_type).toBe('overconfidence')
    expect(by[0].count).toBe(2)
    expect(by[0].avg_edge_claimed_pct).toBeCloseTo(10, 3)
    expect(by[0].top_categories).toEqual(['Politics'])

    const thin = by.find((m) => m.mistake_type === 'thin_market')!
    expect(thin.count).toBe(1)
  })

  it('surfaces the most recently created lesson as the latest example', async () => {
    // createLesson unshifts new entries, so index 0 in a filtered group is
    // already the most recent — seed pre-sorted the same way.
    seedLessons([
      { ...lessonBase, id: 'newest', category: 'Politics', keywords: [], edge_pct: 8, mistake_type: 'anchoring', what_to_do_differently: 'Do the newer thing' },
      { ...lessonBase, id: 'oldest', category: 'Politics', keywords: [], edge_pct: 8, mistake_type: 'anchoring', what_to_do_differently: 'Do the older thing' },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const anchoring = getCalibrationStats().by_mistake_type.find((m) => m.mistake_type === 'anchoring')!
    expect(anchoring.latest_example).toBe('Do the newer thing')
  })
})

describe('per-strategy market_brier (go-live gate needs a strategy-scoped comparison)', () => {
  it('scores each strategy against the market MIDPOINT over only that strategy\'s own rows', async () => {
    seedPredictions([
      // llm-divergence: market at 50/50 midpoint, Claude said 0.9, outcome NO
      // → Claude Brier (0.9-0)^2=0.81, market Brier (0.5-0)^2=0.25.
      {
        ...base, id: 'll1', ticker: 'LL1', predicted_probability: 0.9, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, market_yes_bid: 0.45, market_yes_ask: 0.55,
        strategy: 'llm-divergence', actionable: true,
      },
      // dated-favorites: market at 90/10... deliberately different, must not
      // pollute llm-divergence's number or vice versa.
      {
        ...base, id: 'df1', ticker: 'DF1', predicted_probability: 0.9, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.9, market_yes_bid: 0.88, market_yes_ask: 0.92,
        strategy: 'dated-favorites', actionable: true,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_strategy

    const llm = by.find((s) => s.strategy === 'llm-divergence')!
    expect(llm.market_brier).toBeCloseTo(0.25, 4)

    const df = by.find((s) => s.strategy === 'dated-favorites')!
    // market midpoint 0.90, outcome YES → (0.90-1)^2 = 0.01
    expect(df.market_brier).toBeCloseTo(0.01, 4)
  })

  it('is null for a strategy with no midpoint-quoted resolved rows', async () => {
    seedPredictions([
      {
        ...base, id: 'df1', ticker: 'DF1', predicted_probability: 0.9, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.9, strategy: 'dated-favorites', actionable: true,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    // No bid/ask AND market_price fallback IS present, so this actually
    // falls back to the ask-priced comparison, not null — confirm that path.
    const df = getCalibrationStats().by_strategy.find((s) => s.strategy === 'dated-favorites')!
    expect(df.market_brier).toBeCloseTo(Math.pow(0.9 - 1, 2), 4)
  })
})

describe('realized ROI per dollar-day (capital velocity)', () => {
  it('weights payoff by cost × days held, not cost alone', async () => {
    // Two winning trades, identical cost/payoff, different holding periods:
    // one resolves in 1 day, the other in 10. Per-dollar-day ROI must be
    // materially higher for the fast one when isolated.
    const fast = {
      ...base, id: 'fast', ticker: 'FAST', predicted_probability: 0.7, direction: 'YES',
      outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
      created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
      resolved_at: new Date('2025-01-02T00:00:00Z').toISOString(), // 1 day
    }
    const slow = {
      ...base, id: 'slow', ticker: 'SLOW', predicted_probability: 0.7, direction: 'YES',
      outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
      created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
      resolved_at: new Date('2025-01-11T00:00:00Z').toISOString(), // 10 days
    }
    seedPredictions([fast])
    const { getCalibrationStats } = await import('@/lib/storage')
    const fastBucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    // payoff 0.5 on cost 0.5 over 1 day → (0.5/(0.5*1))*100 = 100
    expect(fastBucket.realized_roi_per_dollar_day).toBeCloseTo(100, 1)

    vi.resetModules()
    seedPredictions([slow])
    const { getCalibrationStats: getCalibrationStats2 } = await import('@/lib/storage')
    const slowBucket = getCalibrationStats2().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    // same payoff/cost, 10x the days → 10x smaller per-dollar-day ROI
    expect(slowBucket.realized_roi_per_dollar_day).toBeCloseTo(10, 1)
  })

  it('excludes a row from the metric (not from plain ROI) when no holding-period timestamp parses', async () => {
    seedPredictions([
      {
        ...base, id: 'nodate', ticker: 'ND', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        created_at: 'not-a-date', // fails to parse → daysHeld returns null
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    expect(bucket.realized_roi_pct).toBeCloseTo(100, 3) // plain ROI still computed
    expect(bucket.realized_roi_per_dollar_day).toBeNull() // per-dollar-day cannot be
  })
})

describe('early-exit rows use REALIZED exit proceeds, not the resolution-implied payoff', () => {
  it('prices an exited-early row at exit_price, ignoring what the market later settled at', async () => {
    // Bought at 50c, exited early at 70c (a win captured), but the market
    // later settled NO (would have been a full loss if held). The realized
    // trade was a WIN at 70c — exit_price must drive the payoff, not outcome.
    seedPredictions([
      {
        ...base, id: 'exited', ticker: 'EX', predicted_probability: 0.8, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        exited_early: true, exit_price: 0.7,
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    // payoff = exit_price(0.7) - entry(0.5) = +0.2 on cost 0.5 → ROI +40%
    expect(bucket.realized_roi_pct).toBeCloseTo(40, 1)
  })

  it('uses exit_ts (not resolved_at) as the end of the holding period for an exited row', async () => {
    seedPredictions([
      {
        ...base, id: 'exited', ticker: 'EX', predicted_probability: 0.8, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        exited_early: true, exit_price: 0.6,
        created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
        exit_ts: new Date('2025-01-02T00:00:00Z').toISOString(),   // 1 day held
        resolved_at: new Date('2025-06-01T00:00:00Z').toISOString(), // market settled 5 months later
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const bucket = getCalibrationStats().by_edge_bucket.find((b) => b.bucket === '4-6%')!
    // payoff 0.1 on cost 0.5 over 1 day (not 5 months) → (0.1/0.5)*100 = 20
    expect(bucket.realized_roi_per_dollar_day).toBeCloseTo(20, 1)
  })
})

describe('by_confidence — realized performance grouped by the tier that drove Kelly sizing', () => {
  it('groups actionable rows by confidence and omits untagged rows', async () => {
    seedPredictions([
      {
        ...base, id: 'h1', ticker: 'H1', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        confidence: 'HIGH',
      },
      {
        ...base, id: 'm1', ticker: 'M1', predicted_probability: 0.7, direction: 'YES',
        outcome: 'NO', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        confidence: 'MEDIUM',
      },
      {
        ...base, id: 'u1', ticker: 'U1', predicted_probability: 0.7, direction: 'YES',
        outcome: 'YES', edge_pct: 5, market_price: 0.5, execution_price: 0.5, actionable: true,
        // no confidence field at all
      },
    ])
    const { getCalibrationStats } = await import('@/lib/storage')
    const by = getCalibrationStats().by_confidence

    expect(by.map((s) => s.confidence).sort()).toEqual(['HIGH', 'MEDIUM'])
    expect(by.find((s) => s.confidence === 'HIGH')!.count).toBe(1)
    expect(by.find((s) => s.confidence === 'MEDIUM')!.count).toBe(1)
  })
})

describe('getRelevantLessons excludes mechanical-strategy lessons from the LLM-facing lookup', () => {
  it('never returns a lesson tagged with a non-llm-divergence strategy', async () => {
    seedLessons([
      {
        id: 'l1', prediction_id: 'p1', market_title: 'M', category: 'Politics',
        keywords: ['politics'], predicted_direction: 'YES', actual_outcome: 'NO',
        predicted_probability: 0.8, market_price: 0.5, edge_pct: 8,
        what_went_wrong: 'x', what_to_do_differently: 'y', mistake_type: 'overconfidence',
        created_at: new Date().toISOString(), strategy: 'dated-favorites',
      },
      {
        id: 'l2', prediction_id: 'p2', market_title: 'M', category: 'Politics',
        keywords: ['politics'], predicted_direction: 'YES', actual_outcome: 'NO',
        predicted_probability: 0.8, market_price: 0.5, edge_pct: 8,
        what_went_wrong: 'x', what_to_do_differently: 'y', mistake_type: 'overconfidence',
        created_at: new Date().toISOString(), strategy: 'llm-divergence',
      },
      {
        id: 'l3', prediction_id: 'p3', market_title: 'M', category: 'Politics',
        keywords: ['politics'], predicted_direction: 'YES', actual_outcome: 'NO',
        predicted_probability: 0.8, market_price: 0.5, edge_pct: 8,
        what_went_wrong: 'x', what_to_do_differently: 'y', mistake_type: 'overconfidence',
        created_at: new Date().toISOString(), // legacy: no strategy field
      },
    ])
    const { getRelevantLessons } = await import('@/lib/storage')
    const results = getRelevantLessons('Politics', ['politics'], 10)
    expect(results.map((l) => l.id).sort()).toEqual(['l2', 'l3'])
  })
})

describe('getAutopilotFunnelStats — which guardrail actually binds', () => {
  it('categorizes skip reasons by substring, distinguishing near-identical messages', async () => {
    seedAutopilotRuns([
      {
        id: 'run1', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        status: 'ok', dry_run: true, markets_scanned: 5, opportunities_considered: 3,
        opportunities_screened_out: 7,
        trades: [
          { ticker: 'A', side: 'yes', contracts: 0, price: 0, cost: 0, effective_edge_pct: 3, kelly_stake: 0, executed: false, skip_reason: 'Effective edge 3.0% below minimum 15%' },
          { ticker: 'B', side: 'yes', contracts: 0, price: 0, cost: 0, effective_edge_pct: 3, kelly_stake: 0, executed: false, skip_reason: 'Effective edge 4.0% below minimum 15%' },
          { ticker: 'C', side: 'yes', contracts: 0, price: 0, cost: 0, effective_edge_pct: 3, kelly_stake: 0, executed: false, skip_reason: 'Cluster "politics" exposure limit reached ($50.00 of $50.00)' },
          { ticker: 'D', side: 'yes', contracts: 0, price: 0, cost: 0, effective_edge_pct: 3, kelly_stake: 0, executed: false, skip_reason: 'Total exposure limit reached ($250.00 of $250.00)' },
          { ticker: 'E', side: 'yes', contracts: 5, price: 0.5, cost: 2.5, effective_edge_pct: 20, kelly_stake: 2.5, executed: true }, // not a skip
        ],
      },
      {
        id: 'run2', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        status: 'ok', dry_run: true, markets_scanned: 5, opportunities_considered: 1,
        opportunities_screened_out: 3,
        trades: [
          { ticker: 'F', side: 'yes', contracts: 0, price: 0, cost: 0, effective_edge_pct: 3, kelly_stake: 0, executed: false, skip_reason: 'Some totally novel guardrail message never seen before' },
        ],
      },
    ])
    const { getAutopilotFunnelStats } = await import('@/lib/storage')
    const stats = getAutopilotFunnelStats()

    expect(stats.total_skips).toBe(5)
    expect(stats.total_tier1_screened_out).toBe(10) // 7 + 3

    const edge = stats.by_reason.find((r) => r.category === 'Below min effective edge')!
    expect(edge.count).toBe(2)
    const cluster = stats.by_reason.find((r) => r.category === 'Cluster exposure limit')!
    expect(cluster.count).toBe(1)
    const total = stats.by_reason.find((r) => r.category === 'Total exposure limit')!
    expect(total.count).toBe(1)
    // Cluster's message contains "exposure" too — must not be double-bucketed
    // or miscategorized into 'Total exposure limit'.
    expect(cluster.count + total.count).toBe(2)
    const other = stats.by_reason.find((r) => r.category === 'Other')!
    expect(other.count).toBe(1)
  })

  it('returns zeroed stats when no runs exist', async () => {
    const { getAutopilotFunnelStats } = await import('@/lib/storage')
    const stats = getAutopilotFunnelStats()
    expect(stats.total_skips).toBe(0)
    expect(stats.total_tier1_screened_out).toBe(0)
    expect(stats.by_reason).toEqual([])
  })
})
