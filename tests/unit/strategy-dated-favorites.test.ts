import { describe, it, expect, vi } from 'vitest'
import { horizonCorrectedProb, DATED_FAVORITES_MAX_SLOPE, datedFavoritesOpportunities } from '@/lib/strategies/datedFavorites'
import { AutopilotSettings } from '@/lib/types'

vi.mock('@/lib/strategies/marketFetch', () => ({
  fetchOpenMarkets: vi.fn(),
}))

describe('dated favorites — horizonCorrectedProb', () => {
  it('returns the price unchanged at day 0 (no horizon correction yet)', () => {
    expect(horizonCorrectedProb(0.75, 0, 56)).toBeCloseTo(0.75, 6)
  })

  it('extremizes a favorite price upward as days-to-resolution grows', () => {
    // A 75c favorite a month out should be corrected ABOVE 75c — logit-space
    // extremization at slope > 1 pushes prices already above 0.5 higher.
    const near = horizonCorrectedProb(0.75, 2, 56)
    const far = horizonCorrectedProb(0.75, 56, 56)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeGreaterThan(0.75)
  })

  it('extremizes a longshot price DOWNWARD as days-to-resolution grows (symmetric in logit space)', () => {
    const near = horizonCorrectedProb(0.25, 2, 56)
    const far = horizonCorrectedProb(0.25, 56, 56)
    expect(far).toBeLessThan(near)
    expect(far).toBeLessThan(0.25)
  })

  it('never exceeds the configured max slope, even past the window edge', () => {
    // days > maxDays should clamp to the same correction as days == maxDays,
    // not extrapolate further.
    const atEdge = horizonCorrectedProb(0.8, 56, 56)
    const beyond = horizonCorrectedProb(0.8, 200, 56)
    expect(beyond).toBeCloseTo(atEdge, 6)
  })

  it('is symmetric around 0.5 — a favorite and its mirror longshot correct oppositely', () => {
    const fav = horizonCorrectedProb(0.7, 30, 56)
    const dog = horizonCorrectedProb(0.3, 30, 56)
    expect(fav + dog).toBeCloseTo(1, 6)
  })

  it('the shipped max slope is deliberately conservative, below the cited research figure (~1.32)', () => {
    // Locks down the "don't raise this toward the cited number on a hunch"
    // intent from docs/STRATEGY_EXPANSION_PLAN.md — a regression here is a
    // signal someone changed risk posture, not just refactored.
    expect(DATED_FAVORITES_MAX_SLOPE).toBeLessThan(1.32)
    expect(DATED_FAVORITES_MAX_SLOPE).toBeGreaterThan(1)
  })
})

function baseAp(overrides: Partial<AutopilotSettings> = {}): AutopilotSettings {
  return {
    dated_favorites_min_price_cents: 60,
    dated_favorites_max_price_cents: 95,
    dated_favorites_min_days: 1,
    dated_favorites_max_days: 90,
    dated_favorites_min_volume_usd: 500,
    ...overrides,
  } as AutopilotSettings
}

function market(overrides: Partial<any> & { id: string; daysOut: number }) {
  const { daysOut, ...rest } = overrides
  return {
    title: overrides.id,
    yes_price: 0.9,
    no_price: 0.12,
    volume_24h: 5000,
    category: 'Economics/Finance',
    resolution_date: new Date(Date.now() + daysOut * 86400000).toISOString(),
    ...rest,
  }
}

describe('dated favorites — capital-velocity fields (annualized_edge_pct / days_to_resolution)', () => {
  it('computes annualized_edge_pct = edge_pct * 365 / days_to_resolution', async () => {
    const { fetchOpenMarkets } = await import('@/lib/strategies/marketFetch')
    vi.mocked(fetchOpenMarkets).mockResolvedValue([market({ id: 'FAV', daysOut: 30 })] as any)

    const [opp] = await datedFavoritesOpportunities(baseAp())
    expect(opp).toBeDefined()
    expect(opp.days_to_resolution).toBeCloseTo(30, 0)
    expect(opp.annualized_edge_pct).toBeCloseTo((opp.edge_pct * 365) / opp.days_to_resolution!, 1)
  })

  it('two candidates at different horizons both carry independently-correct annualized values', async () => {
    // The comparator that actually RANKS opportunities by these values
    // — (b.annualized_edge_pct ?? -Infinity) - (a.annualized_edge_pct ?? ...)
    // — is the exact same formula scan.ts uses, and is already proven to
    // invert raw-edge ranking where appropriate in scan-annualized-edge.test.ts
    // (a 5%/14-day candidate beats a 12%/900-day one once annualized). What
    // this strategy is responsible for is producing a CORRECT annualized
    // value per candidate for that shared comparator to sort on — confirmed
    // here for two different horizons within its own window.
    const { fetchOpenMarkets } = await import('@/lib/strategies/marketFetch')
    vi.mocked(fetchOpenMarkets).mockResolvedValue([
      market({ id: 'NEAR', daysOut: 20, yes_price: 0.94 }),
      market({ id: 'FAR', daysOut: 89, yes_price: 0.94 }),
    ] as any)

    const opps = await datedFavoritesOpportunities(baseAp())
    const near = opps.find((o) => o.ticker === 'NEAR')!
    const far = opps.find((o) => o.ticker === 'FAR')!
    expect(near.annualized_edge_pct).toBeCloseTo((near.edge_pct * 365) / near.days_to_resolution!, 1)
    expect(far.annualized_edge_pct).toBeCloseTo((far.edge_pct * 365) / far.days_to_resolution!, 1)
  })
})

describe('dated favorites — liquidity floor downgrades confidence, doesn\'t exclude', () => {
  it('reports HIGH confidence above the volume floor', async () => {
    const { fetchOpenMarkets } = await import('@/lib/strategies/marketFetch')
    vi.mocked(fetchOpenMarkets).mockResolvedValue([market({ id: 'LIQUID', daysOut: 30, volume_24h: 5000 })] as any)

    const [opp] = await datedFavoritesOpportunities(baseAp({ dated_favorites_min_volume_usd: 500 }))
    expect(opp.confidence).toBe('HIGH')
  })

  it('downgrades to MEDIUM below the volume floor instead of excluding the opportunity', async () => {
    const { fetchOpenMarkets } = await import('@/lib/strategies/marketFetch')
    vi.mocked(fetchOpenMarkets).mockResolvedValue([market({ id: 'THIN', daysOut: 30, volume_24h: 50 })] as any)

    const [opp] = await datedFavoritesOpportunities(baseAp({ dated_favorites_min_volume_usd: 500 }))
    expect(opp).toBeDefined() // NOT excluded
    expect(opp.confidence).toBe('MEDIUM')
    expect(opp.rationale).toMatch(/thin market/i)
  })
})
