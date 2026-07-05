import { describe, it, expect } from 'vitest'

// Replicates the annualization + ranking logic added to runScan's scored map
// (src/lib/scan.ts): a market's effective edge is scaled to a 365-day capital
// velocity basis before ranking, so a small edge that resolves fast outranks
// a larger edge that ties up capital for years. This mirrors scan-edge.test.ts's
// approach of locking the formula in a standalone function rather than
// exercising the full network pipeline.
function annualizedEdgePct(effectiveEdgePct: number, daysToResolution: number | null): number | null {
  if (daysToResolution == null) return null
  const days = Math.max(1, daysToResolution)
  return parseFloat(((effectiveEdgePct * 365) / days).toFixed(1))
}

function rankOpportunities<T extends { edge_pct: number; annualized_edge_pct: number | null }>(
  opps: T[]
): T[] {
  return [...opps].sort(
    (a, b) => (b.annualized_edge_pct ?? -Infinity) - (a.annualized_edge_pct ?? -Infinity) || b.edge_pct - a.edge_pct
  )
}

describe('annualized edge formula', () => {
  it('scales a 1-week edge up by roughly 52x', () => {
    const edge = annualizedEdgePct(5, 7)
    expect(edge).toBeCloseTo((5 * 365) / 7, 1)
    expect(edge).toBeGreaterThan(250)
  })

  it('scales a 2-year edge down to a small fraction of the raw number', () => {
    const edge = annualizedEdgePct(8, 730)
    expect(edge).toBeCloseTo(4, 1)
  })

  it('floors days at 1 so a same-day market never divides toward infinity', () => {
    const edge = annualizedEdgePct(2, 0.1)
    expect(edge).toBe(2 * 365) // treated as 1 day, not 0.1
    expect(Number.isFinite(edge)).toBe(true)
  })

  it('returns null when there is no resolution date to annualize against', () => {
    expect(annualizedEdgePct(10, null)).toBeNull()
  })
})

describe('ranking by annualized edge', () => {
  it('ranks a smaller edge that resolves fast above a larger edge that resolves in years', () => {
    const shortDated = { ticker: 'FAST', edge_pct: 5, annualized_edge_pct: annualizedEdgePct(5, 14) }
    const longDated = { ticker: 'SLOW', edge_pct: 12, annualized_edge_pct: annualizedEdgePct(12, 900) }
    const ranked = rankOpportunities([longDated, shortDated])
    expect(ranked[0].ticker).toBe('FAST')
    expect(ranked[1].ticker).toBe('SLOW')
  })

  it('falls back to raw edge_pct when annualized edge is tied or both are null (undated markets)', () => {
    const a = { ticker: 'A', edge_pct: 6, annualized_edge_pct: null }
    const b = { ticker: 'B', edge_pct: 9, annualized_edge_pct: null }
    const ranked = rankOpportunities([a, b])
    expect(ranked[0].ticker).toBe('B')
  })

  it('sorts every dated opportunity ahead of undated ones regardless of raw edge size', () => {
    const undated = { ticker: 'UNDATED', edge_pct: 50, annualized_edge_pct: null }
    const dated = { ticker: 'DATED', edge_pct: 3, annualized_edge_pct: annualizedEdgePct(3, 30) }
    const ranked = rankOpportunities([undated, dated])
    expect(ranked[0].ticker).toBe('DATED')
  })
})
