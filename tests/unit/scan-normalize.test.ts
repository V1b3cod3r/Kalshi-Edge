import { describe, it, expect } from 'vitest'
import { normalizeMarket, mapCategory } from '@/lib/scan'

// normalizeMarket is the money-critical translation layer between raw Kalshi
// payloads (whose price fields are integer CENTS in v2, dollars in *_dollars
// variants) and our internal 0–1 decimal prices. A factor-of-100 mistake here
// silently corrupts every downstream edge computation.

describe('normalizeMarket — price parsing', () => {
  it('converts cent-integer ask prices to decimal dollars', () => {
    const m = normalizeMarket({
      ticker: 'FED-DEC',
      title: 'Will the Fed cut in December?',
      yes_ask: 55,
      no_ask: 47,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.55, 6)
    expect(m!.no_price).toBeCloseTo(0.47, 6)
  })

  it('prefers *_dollars string fields over the plain cent fields', () => {
    const m = normalizeMarket({
      ticker: 'T1',
      title: 'Dollars field wins',
      yes_ask_dollars: '0.55',
      yes_ask: 60, // conflicting cent value must be ignored
      no_ask_dollars: '0.47',
      no_ask: 40,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.55, 6)
    expect(m!.no_price).toBeCloseTo(0.47, 6)
  })

  it('parses a 1-cent quote as 0.01, never 1.0', () => {
    // Raw `1` in the plain field is 1¢ (integer cents), not $1. Treating it as
    // $1 would make a 1¢ long-shot look like a certainty.
    const m = normalizeMarket({
      ticker: 'LONGSHOT',
      title: 'Extreme long shot',
      yes_ask: 1,
      no_ask: 99,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.01, 6)
    expect(m!.no_price).toBeCloseTo(0.99, 6)
  })

  it('keeps sub-1 plain-field values as dollars (legacy payloads)', () => {
    const m = normalizeMarket({
      ticker: 'LEGACY',
      title: 'Legacy dollar payload',
      yes_ask: 0.55,
      no_ask: 0.47,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.55, 6)
    expect(m!.no_price).toBeCloseTo(0.47, 6)
  })

  it('derives the NO ask from 1 − yes_bid when NO quotes are missing', () => {
    const m = normalizeMarket({
      ticker: 'NOBOOK',
      title: 'No NO-side quotes',
      yes_ask: 55,
      yes_bid: 43,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.55, 6)
    // 1 − 0.43 = 0.57 — mirrors the yes side; never 1 − yes_ask, which would
    // understate the NO cost by the full spread.
    expect(m!.no_price).toBeCloseTo(0.57, 6)
  })

  it('derives the YES ask from 1 − no_bid when YES quotes are missing', () => {
    const m = normalizeMarket({
      ticker: 'YESBOOK',
      title: 'No YES-side quotes',
      no_ask: 47,
      no_bid: 44,
    })
    expect(m).not.toBeNull()
    expect(m!.yes_price).toBeCloseTo(0.56, 6) // 1 − 0.44
    expect(m!.no_price).toBeCloseTo(0.47, 6)
  })

  it('drops the market when NO quotes AND yes_bid are both missing', () => {
    const m = normalizeMarket({
      ticker: 'HALFBOOK',
      title: 'Only a YES ask',
      yes_ask: 55,
    })
    expect(m).toBeNull()
  })

  it('drops markets that only have a stale last_price', () => {
    // A last trade print is staleness, not an executable market.
    const m = normalizeMarket({
      ticker: 'STALE',
      title: 'Stale market',
      yes_ask: 0,
      yes_bid: 0,
      no_ask: 0,
      no_bid: 0,
      last_price: 50,
    })
    expect(m).toBeNull()
  })

  it('drops markets with no title', () => {
    const m = normalizeMarket({ ticker: 'NOTITLE', yes_ask: 50, no_ask: 52 })
    expect(m).toBeNull()
  })
})

describe('normalizeMarket — MVE parlay bundles', () => {
  it('drops markets whose ticker contains KXMVE', () => {
    const m = normalizeMarket({
      ticker: 'KXMVE-COMBO-123',
      title: 'Multi-leg parlay',
      yes_ask: 50,
      no_ask: 52,
    })
    expect(m).toBeNull()
  })

  it('drops markets carrying mve_selected_legs', () => {
    const m = normalizeMarket({
      ticker: 'NORMAL-TICKER',
      title: 'Parlay by field',
      yes_ask: 50,
      no_ask: 52,
      mve_selected_legs: [{ ticker: 'LEG1' }],
    })
    expect(m).toBeNull()
  })
})

describe('normalizeMarket — volume fallbacks', () => {
  // Dollar volume = contracts × midpoint, where midpoint is the mean of the
  // yes ask (yes_price) and the yes bid (1 − no_price).
  const base = { ticker: 'VOL', title: 'Volume test', yes_ask: 55, no_ask: 47 }
  const midpoint = (0.55 + (1 - 0.47)) / 2 // 0.54

  it('uses volume_24h when present', () => {
    const m = normalizeMarket({ ...base, volume_24h: 1000, volume: 99999 })
    expect(m).not.toBeNull()
    expect(m!.volume_24h).toBeCloseTo(1000 * midpoint, 6) // $540
  })

  it('falls back to lifetime volume when volume_24h is absent', () => {
    const m = normalizeMarket({ ...base, volume: 2000 })
    expect(m).not.toBeNull()
    expect(m!.volume_24h).toBeCloseTo(2000 * midpoint, 6) // $1080
  })

  it('defaults to 0 when no volume field exists', () => {
    const m = normalizeMarket({ ...base })
    expect(m).not.toBeNull()
    expect(m!.volume_24h).toBe(0)
  })

  it('computes dollar volume as contracts × midpoint', () => {
    const m = normalizeMarket({
      ticker: 'DV',
      title: 'Dollar volume',
      yes_ask: 60,
      no_ask: 42,
      volume_24h: 500,
    })
    // midpoint = (0.60 + (1 − 0.42)) / 2 = 0.59 → 500 × 0.59 = $295
    expect(m).not.toBeNull()
    expect(m!.volume_24h).toBeCloseTo(295, 6)
  })
})

describe('normalizeMarket — metadata', () => {
  it('carries ticker as id and maps category', () => {
    const m = normalizeMarket({
      ticker: 'KXCPI-25APR',
      title: 'Will CPI exceed 3%?',
      yes_ask: 40,
      no_ask: 62,
      close_time: '2026-12-31T00:00:00Z',
      rules_primary: 'Resolves YES if CPI > 3%',
    })
    expect(m).not.toBeNull()
    expect(m!.id).toBe('KXCPI-25APR')
    expect(m!.category).toBe('Economics/Finance')
    expect(m!.resolution_date).toBe('2026-12-31T00:00:00Z')
    expect(m!.resolution_criteria).toBe('Resolves YES if CPI > 3%')
  })
})

describe('mapCategory', () => {
  it('honors an explicit Kalshi category string', () => {
    expect(mapCategory('Politics', 'XYZ', 'Some neutral title')).toBe('Politics & Elections')
    expect(mapCategory('Economics', 'XYZ', 'Some neutral title')).toBe('Economics/Finance')
    expect(mapCategory('Sports', 'XYZ', 'Some neutral title')).toBe('Sports')
  })

  it('falls back to title keywords when the category field is missing', () => {
    // Kalshi market objects often ship without a category (it lives on the
    // parent event) — keyword fallback prevents everything bucketing as Other.
    expect(mapCategory(undefined, undefined, 'Will the Fed cut rates')).toBe('Economics/Finance')
    expect(mapCategory(undefined, undefined, 'NBA Finals winner')).toBe('Sports')
    expect(mapCategory(undefined, undefined, 'Will Trump win the nomination?')).toBe('Politics & Elections')
  })

  it('falls back to ticker keywords too', () => {
    expect(mapCategory(undefined, 'KXNBA-CHAMP', 'Championship winner')).toBe('Sports')
    expect(mapCategory(undefined, 'KXBTCUSD-100K', 'Above 100k by June?')).toBe('Economics/Finance')
  })

  it('returns Other/General for unknown markets', () => {
    expect(mapCategory(undefined, 'KXRAIN-NYC', 'Will it rain in NYC tomorrow?')).toBe('Other/General')
    expect(mapCategory('', undefined, undefined)).toBe('Other/General')
  })
})
