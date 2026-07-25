import { describe, it, expect } from 'vitest'
import { clusterForTicker, eventKeyFromTicker } from '@/lib/autopilot'

// Phase 2 (Kelly confidence haircut) and Phase 6 (event-based correlation
// clustering) from the strategy plan.

describe('Phase 6 — correlation clustering by event, not ticker prefix', () => {
  it('derives the event key by dropping the strike segment', () => {
    expect(eventKeyFromTicker('KXTEMPNYCH-26JUL1207-T74.99')).toBe('KXTEMPNYCH-26JUL1207')
    expect(eventKeyFromTicker('KXHIGHNY-26JUL12-B80')).toBe('KXHIGHNY-26JUL12')
  })

  it('returns null for a ticker with no strike segment (nothing to derive)', () => {
    expect(eventKeyFromTicker('SOLO')).toBeNull()
  })

  it('groups different strikes on the SAME event into one cluster', () => {
    // The old 4-char-prefix fallback also grouped these, but only by accident
    // of a shared prefix. The point is that several strikes on one underlying
    // question are ONE bet and must share a cluster cap.
    const a = clusterForTicker('KXTEMPNYCH-26JUL1207-T74.99', 'NYC high temp')
    const b = clusterForTicker('KXTEMPNYCH-26JUL1207-T78.99', 'NYC high temp')
    expect(a).toBe(b)
  })

  it('separates different events that share a 4-char prefix (the old bug)', () => {
    // 'KXQU...' — under the old `ticker.slice(0,4)` fallback these collided
    // into one cluster despite being unrelated questions, so the per-cluster
    // cap bound on markets that were not actually correlated.
    const quantum = clusterForTicker('KXQUANTUM-35', 'Quantum computing milestone')
    const quake = clusterForTicker('KXQUAKE-30', 'Major earthquake')
    expect(quantum).not.toBe(quake)
  })

  it('still prefers keyword clusters — they capture cross-EVENT correlation', () => {
    // Two different Fed events are still one macro bet; the broader keyword
    // cluster is the more conservative cap and must win over the event key.
    const a = clusterForTicker('KXFEDDECISION-26SEP', 'Fed rate decision')
    const b = clusterForTicker('KXRATECUT-26DEC', 'Fed rate cut count')
    expect(a).toBe(b)
    expect(a).toBe('macro-rates')
  })

  it('produces the SAME key for a bare position ticker and a scan opportunity', () => {
    // Critical: existing Kalshi positions and new scan opportunities must land
    // in the same keyspace, or the exposure cap silently compares two
    // different things and never binds. Positions carry no title.
    const fromPosition = clusterForTicker('KXNEXTAG-29-TBLA')
    const fromOpportunity = clusterForTicker('KXNEXTAG-29-TBLA', 'Some market title')
    expect(fromPosition).toBe(fromOpportunity)
  })
})

describe('Phase 2 — Kelly confidence haircut (verifies the sizing formula)', () => {
  // Mirrors evaluateOpportunity's sizing math. Kelly is hypersensitive to
  // error in p, so we size from a conservative lower bound instead of the
  // point estimate. These assert the DIRECTION and MAGNITUDE of that effect.
  const kelly = (p: number, price: number) => {
    const b = (1 - price) / price
    return (p * b - (1 - p)) / b
  }
  const haircut = (p: number, pp: number) => Math.max(0.01, p - pp / 100)

  it('sizes a LOW-confidence bet strictly smaller than an identical HIGH-confidence one', () => {
    const pRaw = 0.60
    const price = 0.50
    const high = kelly(haircut(pRaw, 3), price)
    const low = kelly(haircut(pRaw, 8), price)
    expect(high).toBeGreaterThan(low)
    expect(low).toBeGreaterThan(0)
  })

  it('can push a marginal opportunity to non-positive Kelly (correctly skipped)', () => {
    // At 50¢, breakeven is p = 0.50. A 52% estimate is a real but thin edge;
    // an 8pp LOW-confidence haircut takes it to 44% — below breakeven, so the
    // trade must be rejected rather than sized down to something tiny.
    const pRaw = 0.52
    const price = 0.50
    expect(kelly(pRaw, price)).toBeGreaterThan(0)
    expect(kelly(haircut(pRaw, 8), price)).toBeLessThan(0)
  })

  it('never lets the haircut drive the probability negative', () => {
    expect(haircut(0.02, 8)).toBe(0.01)
  })
})
