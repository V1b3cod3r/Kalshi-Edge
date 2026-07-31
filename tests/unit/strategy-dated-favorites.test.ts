import { describe, it, expect } from 'vitest'
import { horizonCorrectedProb, DATED_FAVORITES_MAX_SLOPE } from '@/lib/strategies/datedFavorites'

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
