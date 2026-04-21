import { describe, it, expect } from 'vitest'
import {
  buildAnalysisSystemPrompt,
  buildScannerSystemPrompt,
  buildAnalysisUserMessage,
  buildScannerUserMessage,
} from '@/lib/prompts'
import { MacroView, SessionState, MarketInput } from '@/lib/types'

const baseSession: SessionState = {
  current_bankroll: 10000,
  starting_bankroll: 10000,
  positions: [],
  corr_groups: {},
  recent_win_rate: 0.58,
  kelly_modifier: 1.0,
  avoid_categories: [],
  max_new_positions: 5,
}

const sampleMarket: MarketInput = {
  id: 'TEST-1',
  title: 'Will the Fed cut rates in Q4?',
  yes_price: 0.45,
  no_price: 0.55,
  volume_24h: 2500,
  category: 'Economics/Finance',
  resolution_date: '2025-12-31',
  resolution_criteria: 'Fed lowers rate by at least 25bps',
}

const sampleView: MacroView = {
  id: 'view-001',
  thesis: 'Fed will cut rates due to slowing inflation',
  direction: 'DOVISH',
  conviction: 'HIGH',
  timeframe: 'through 2025-12-31',
  affects_category: 'Economics/Finance',
  affects_keywords: ['fed', 'rate', 'fomc'],
  p_implied: 0.7,
  notes: 'CPI trending down',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

// ─── System Prompts ───────────────────────────────────────────────────────────

describe('buildAnalysisSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildAnalysisSystemPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('contains Kelly Criterion instruction', () => {
    const prompt = buildAnalysisSystemPrompt()
    expect(prompt).toContain('Kelly')
  })

  it('contains macro view integration protocol', () => {
    const prompt = buildAnalysisSystemPrompt()
    expect(prompt).toContain('Macro View')
    expect(prompt).toContain('p_blended')
  })
})

describe('buildScannerSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildScannerSystemPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('mentions SCANNER MODE', () => {
    const prompt = buildScannerSystemPrompt()
    expect(prompt).toContain('SCANNER MODE')
  })

  it('describes composite score formula', () => {
    const prompt = buildScannerSystemPrompt()
    expect(prompt).toContain('score ≥')
  })
})

// ─── buildAnalysisUserMessage ─────────────────────────────────────────────────

describe('buildAnalysisUserMessage', () => {
  it('includes market title and prices', () => {
    const msg = buildAnalysisUserMessage(sampleMarket, [], baseSession)
    expect(msg).toContain('Will the Fed cut rates in Q4?')
    expect(msg).toContain('0.45')
    expect(msg).toContain('0.55')
  })

  it('includes session bankroll', () => {
    const msg = buildAnalysisUserMessage(sampleMarket, [], baseSession)
    expect(msg).toContain('10,000')
    expect(msg).toContain('SESSION:')
  })

  it('includes resolution criteria when provided', () => {
    const msg = buildAnalysisUserMessage(sampleMarket, [], baseSession)
    expect(msg).toContain('Fed lowers rate by at least 25bps')
  })

  it('includes active views when provided', () => {
    const msg = buildAnalysisUserMessage(sampleMarket, [sampleView], baseSession)
    expect(msg).toContain('VIEWS:')
    expect(msg).toContain('view-001')
    expect(msg).toContain('Fed will cut rates due to slowing inflation')
    expect(msg).toContain('HIGH')
  })

  it('omits VIEWS section when no views provided', () => {
    const msg = buildAnalysisUserMessage(sampleMarket, [], baseSession)
    expect(msg).not.toContain('VIEWS:')
  })

  it('includes kelly_modifier from session', () => {
    const sessionWith075 = { ...baseSession, kelly_modifier: 0.75 }
    const msg = buildAnalysisUserMessage(sampleMarket, [], sessionWith075)
    expect(msg).toContain('0.75')
  })

  it('includes existing positions when present', () => {
    const sessionWithPositions: SessionState = {
      ...baseSession,
      positions: [
        {
          id: 'pos-1',
          market: 'FED-RATE-DEC',
          direction: 'YES',
          contracts: 10,
          avg_price: 0.42,
          current_price: 0.45,
          category: 'Economics/Finance',
          corr_group: 'fed-rates',
        },
      ],
    }
    const msg = buildAnalysisUserMessage(sampleMarket, [], sessionWithPositions)
    expect(msg).toContain('FED-RATE-DEC')
    expect(msg).toContain('YES')
    expect(msg).toContain('fed-rates')
  })
})

// ─── buildScannerUserMessage ──────────────────────────────────────────────────

describe('buildScannerUserMessage', () => {
  const markets: MarketInput[] = [
    {
      title: 'Will inflation fall below 3%?',
      yes_price: 0.6,
      no_price: 0.4,
      volume_24h: 1000,
      category: 'Economics/Finance',
    },
    {
      title: 'Will the Packers win the Super Bowl?',
      yes_price: 0.15,
      no_price: 0.85,
      volume_24h: 5000,
      category: 'Sports',
    },
  ]

  it('lists all market titles', () => {
    const msg = buildScannerUserMessage(markets, [], baseSession)
    expect(msg).toContain('Will inflation fall below 3%?')
    expect(msg).toContain('Will the Packers win the Super Bowl?')
  })

  it('includes market count in message', () => {
    const msg = buildScannerUserMessage(markets, [], baseSession)
    expect(msg).toContain('2 markets')
  })

  it('includes yes/no prices for each market', () => {
    const msg = buildScannerUserMessage(markets, [], baseSession)
    expect(msg).toContain('0.60')
    expect(msg).toContain('0.40')
    expect(msg).toContain('0.15')
    expect(msg).toContain('0.85')
  })

  it('includes active views block when views provided', () => {
    const msg = buildScannerUserMessage(markets, [sampleView], baseSession)
    expect(msg).toContain('VIEWS:')
    expect(msg).toContain('view-001')
  })

  it('omits VIEWS section when no views', () => {
    const msg = buildScannerUserMessage(markets, [], baseSession)
    expect(msg).not.toContain('VIEWS:')
  })

  it('includes session bankroll', () => {
    const msg = buildScannerUserMessage(markets, [], baseSession)
    expect(msg).toContain('SESSION:')
    expect(msg).toContain('10,000')
  })
})
