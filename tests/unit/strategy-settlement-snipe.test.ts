import { describe, it, expect } from 'vitest'
import {
  parseTempTicker,
  parseThresholdFromTicker,
  inferDirectionFromTitle,
} from '@/lib/strategies/settlementSnipe'

describe('settlement snipe — parseTempTicker', () => {
  it('parses a verified KXTEMP<CITY><H|L> prefix, ignoring the strike segment', () => {
    expect(parseTempTicker('KXTEMPNYCH-26JUL1207-T74.99')).toEqual({ cityCode: 'NYC', kind: 'H' })
    expect(parseTempTicker('KXTEMPLAXL-26JUL1207-T55.00')).toEqual({ cityCode: 'LAX', kind: 'L' })
  })

  it('returns null for a ticker that does not match the exact shape (fail-safe, never guesses)', () => {
    expect(parseTempTicker('KXTEMP-26JUL12')).toBeNull()
    expect(parseTempTicker('SOMETHINGELSE-26JUL12-T50')).toBeNull()
    expect(parseTempTicker('KXTEMPNYCX-26JUL12-T50')).toBeNull() // X is not H or L
  })
})

describe('settlement snipe — parseThresholdFromTicker', () => {
  it('parses a clean T<number> threshold segment', () => {
    expect(parseThresholdFromTicker('KXTEMPNYCH-26JUL1207-T74.99')).toBeCloseTo(74.99, 6)
    expect(parseThresholdFromTicker('KXTEMPNYCH-26JUL1207-T80')).toBeCloseTo(80, 6)
  })

  it('returns null for a non-threshold format rather than guessing (range buckets, etc.)', () => {
    expect(parseThresholdFromTicker('KXTEMPNYCH-26JUL1207-B70T80')).toBeNull()
    expect(parseThresholdFromTicker('KXTEMPNYCH-26JUL1207')).toBeNull()
  })
})

describe('settlement snipe — inferDirectionFromTitle', () => {
  it('infers "above" from clear above-language', () => {
    expect(inferDirectionFromTitle('Will the NYC high temp exceed 75°F?')).toBe('above')
    expect(inferDirectionFromTitle('NYC high > 75°F')).toBe('above')
  })

  it('infers "below" from clear below-language', () => {
    expect(inferDirectionFromTitle('Will the NYC low be below 32°F?')).toBe('below')
    expect(inferDirectionFromTitle('NYC low < 32°F')).toBe('below')
  })

  it('returns null when the title is ambiguous or corroborates neither direction — fail safe, never guesses', () => {
    expect(inferDirectionFromTitle('NYC temperature market')).toBeNull()
  })

  it('returns null when a title contradicts itself (both above and below language present)', () => {
    // Getting direction wrong on a near-certainty strategy is the worst
    // failure mode it could have — an ambiguous/contradictory title must
    // skip, not pick one at random.
    expect(inferDirectionFromTitle('Will it be above 70 and below 90?')).toBeNull()
  })
})
