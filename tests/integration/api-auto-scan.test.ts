import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// callClaude uses client.messages.stream(...).finalMessage(); mockCreate
// captures the request params and provides the final message.
const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      stream: (params: any) => ({ finalMessage: () => mockCreate(params) }),
    }
    constructor(_opts: any) {}
  },
}))

// Prevent real network calls from signals + search modules
vi.mock('@/lib/signals', () => ({
  getSignalsForMarkets: vi.fn().mockResolvedValue(new Map()),
  formatSignals: vi.fn().mockReturnValue(''),
}))
vi.mock('@/lib/search', () => ({
  getWebContextForMarkets: vi.fn().mockResolvedValue(new Map()),
  formatWebContext: vi.fn().mockReturnValue(''),
}))

// Return valid scanner JSON from Claude matching the current ScanResultSchema.
// my_estimate_pct defaults high enough that the code-side effective-edge
// recomputation (shrinkage + fee) clears the MIN_EFFECTIVE_EDGE threshold.
function mockClaudeScan(opps: Array<{ ticker: string; estimate?: number }>) {
  const scanJson = JSON.stringify({
    opportunities: opps.map(({ ticker, estimate = 80 }) => ({
      ticker,
      title: `Opportunity ${ticker}`,
      direction: 'YES',
      my_estimate_pct: estimate,
      market_price_pct: 50,
      edge_pct: 10,
      score: 75,
      rationale: 'test rationale',
      key_risk: 'test risk',
      flags: [],
      confidence: 'HIGH',
    })),
    screened_out: [],
    session_notes: 'test session',
  })
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: scanJson }] })
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  mockCreate.mockReset()
  vi.unstubAllGlobals()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/auto-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockKalshiMarkets(markets: any[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ markets, cursor: null }),
    text: () => Promise.resolve(''),
  }))
}

// volume_24h is a CONTRACT count; the pipeline converts to dollar volume as
// contracts × midpoint. yes_bid is required — markets without a NO-side quote
// (no no_ask and no yes_bid) are dropped as unquotable.
const openMarkets = [
  { ticker: 'FED-DEC', title: 'Will Fed cut in December?', yes_ask: 45, yes_bid: 43, volume_24h: 5000, category: 'Economics' },
  { ticker: 'NFL-KC', title: 'Will Chiefs win Super Bowl?', yes_ask: 30, yes_bid: 28, volume_24h: 12000, category: 'Sports' },
  { ticker: 'PRES-2024', title: 'Who wins the election?', yes_ask: 55, yes_bid: 52, volume_24h: 20000, category: 'Politics' },
]

describe('POST /api/auto-scan', () => {
  it('returns 400 when kalshi_api_key is missing', async () => {
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 5 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Kalshi')
  })

  it('returns 400 when anthropic_api_key is missing', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    saveSettings(settings)

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 5 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Anthropic')
  })

  it('returns 404 when no markets pass filters', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    // Markets with extreme prices that should be filtered out
    mockKalshiMarkets([
      { ticker: 'NEAR-YES', title: 'Near certain YES', yes_ask: 98, yes_bid: 97, volume_24h: 1000 },
      { ticker: 'NEAR-NO', title: 'Near certain NO', yes_ask: 2, yes_bid: 1, volume_24h: 1000 },
    ])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    // Error names the funnel stage that emptied the scan
    expect(data.error).toContain('No markets survived filtering')
    expect(data.error).toContain('Funnel')
  })

  it('normalizes Kalshi cent-prices to decimal and recomputes effective edge', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'FED-DEC', title: 'Fed cut December', yes_ask: 45, yes_bid: 43, volume_24h: 5000 },
    ])
    mockClaudeScan([{ ticker: 'FED-DEC', estimate: 75 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // yes_price uses ask price: 45 cents → 0.45 decimal
    expect(data.opportunities[0].yes_price).toBeCloseTo(0.45, 2)
    // NO ask is derived from 1 − yes_bid (never 1 − yes_ask, which would be
    // the yes bid and understate cost): 1 − 0.43 = 0.57
    expect(data.opportunities[0].no_price).toBeCloseTo(0.57, 2)
    // Effective edge is recomputed in code, never taken from Claude:
    // p_shrunk = 0.6×0.45 + 0.4×0.75 = 0.57
    // fee = 0.07 × 0.45 × 0.55 = 0.017325
    // edge = (0.57 − 0.45 − 0.017325) × 100 = 10.27 (2dp)
    expect(data.opportunities[0].edge_pct).toBeCloseTo(10.27, 2)
    expect(data.opportunities[0].p_shrunk).toBeCloseTo(0.57, 6)
    expect(data.opportunities[0].execution_price).toBeCloseTo(0.45, 6)
  })

  it('drops markets that only have a stale last_price (no live orderbook)', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    // yes_ask=0, yes_bid=0, only a last trade print — there is no live market
    // to execute against, so the market must be dropped, not priced at 0.50.
    mockKalshiMarkets([
      { ticker: 'STALE', title: 'Stale price test', yes_ask: 0, yes_bid: 0, last_price: 50, volume_24h: 2000 },
    ])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data.error).toContain('No markets survived filtering')
    // Funnel shows the market died at the two-sided-quote stage
    expect(data.error).toContain('0 with live two-sided quotes')
  })

  it('filters out markets with yes_price below 0.03', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'EXTREME-LOW', title: 'Near zero', yes_ask: 2, yes_bid: 1, volume_24h: 1000 },
      { ticker: 'NORMAL', title: 'Normal market', yes_ask: 45, yes_bid: 43, volume_24h: 5000 },
    ])
    mockClaudeScan([{ ticker: 'NORMAL', estimate: 75 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // EXTREME-LOW filtered out — only NORMAL passes to Claude
    expect(data.markets_scanned).toBe(1)
    expect(data.opportunities[0].ticker).toBe('NORMAL')
  })

  it('filters out markets with yes_price above 0.97', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'EXTREME-HIGH', title: 'Near certain', yes_ask: 98, yes_bid: 97, volume_24h: 1000 },
      { ticker: 'NORMAL', title: 'Normal market', yes_ask: 55, yes_bid: 53, volume_24h: 5000 },
    ])
    mockClaudeScan([{ ticker: 'NORMAL', estimate: 80 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // EXTREME-HIGH filtered out — only NORMAL passes to Claude
    expect(data.markets_scanned).toBe(1)
    expect(data.opportunities[0].ticker).toBe('NORMAL')
  })

  it('applies min_volume filter on dollar volume (contracts × midpoint)', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    // LOW-VOL: 100 contracts × mid 0.44 = $44 (< 500, dropped)
    // HIGH-VOL: 5000 contracts × mid 0.54 = $2700 (≥ 500, kept)
    mockKalshiMarkets([
      { ticker: 'LOW-VOL', title: 'Low volume', yes_ask: 45, yes_bid: 43, volume_24h: 100 },
      { ticker: 'HIGH-VOL', title: 'High volume', yes_ask: 55, yes_bid: 53, volume_24h: 5000 },
    ])
    mockClaudeScan([{ ticker: 'HIGH-VOL', estimate: 80 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15, min_volume: 500 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // LOW-VOL filtered out — only HIGH-VOL passes to Claude
    expect(data.markets_scanned).toBe(1)
    expect(data.opportunities[0].ticker).toBe('HIGH-VOL')
  })

  it('sorts by volume descending and returns top N', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'LOW', title: 'Low volume market', yes_ask: 40, yes_bid: 38, volume_24h: 500 },
      { ticker: 'HIGH', title: 'High volume market', yes_ask: 60, yes_bid: 58, volume_24h: 10000 },
      { ticker: 'MED', title: 'Medium volume market', yes_ask: 50, yes_bid: 48, volume_24h: 2000 },
    ])
    mockClaudeScan([{ ticker: 'HIGH', estimate: 85 }, { ticker: 'MED', estimate: 80 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 2 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // limit=2 keeps the two highest volume markets (LOW dropped)
    expect(data.markets_scanned).toBe(2)
    // Volume ordering: Claude user message should mention HIGH before MED
    const userMsg = mockCreate.mock.calls[0][0].messages[0].content
    expect(userMsg.indexOf('High volume')).toBeLessThan(userMsg.indexOf('Medium volume'))
    expect(userMsg).not.toContain('Low volume market')
  })

  it('screens out opportunities below the effective-edge threshold with receipts', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'WEAK', title: 'Weak edge market', yes_ask: 50, yes_bid: 48, volume_24h: 5000 },
    ])
    // estimate 55%: p_shrunk = 0.6×0.50 + 0.4×0.55 = 0.52
    // edge = (0.52 − 0.50 − 0.07×0.5×0.5) × 100 = 0.25% < 2.5% threshold
    mockClaudeScan([{ ticker: 'WEAK', estimate: 55 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.opportunities).toHaveLength(0)
    const screened = data.screened_out.find((s: any) => s.ticker === 'WEAK')
    expect(screened).toBeDefined()
    expect(screened.reason).toContain('Effective edge')
  })

  it('screens out opportunities whose ticker matches no scanned market', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'REAL-MKT', title: 'Real market', yes_ask: 45, yes_bid: 43, volume_24h: 5000 },
    ])
    // Claude hallucinates a ticker that was never scanned — prices cannot be
    // verified, so the opportunity must be dropped, not trusted.
    mockClaudeScan([{ ticker: 'HALLUCINATED', estimate: 90 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.opportunities).toHaveLength(0)
    const screened = data.screened_out.find((s: any) => s.ticker === 'HALLUCINATED')
    expect(screened).toBeDefined()
    expect(screened.reason).toContain('did not match any scanned market')
  })

  it('clamps an out-of-range percentage instead of failing the whole scan', async () => {
    // Structured outputs guarantees field TYPES but the API does not support
    // numeric min/max constraints, so Claude can legally emit e.g. 104.2 for
    // a percentage. That used to hard-fail the entire scan via a Zod .parse()
    // throw ("Claude returned an unexpected format") even though the payload
    // was otherwise perfectly good.
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets(openMarkets)
    mockCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          opportunities: [{
            ticker: 'FED-DEC',
            title: 'Will Fed cut in December?',
            direction: 'YES',
            my_estimate_pct: 104.2, // out of [0,100] — API schema can't enforce this
            market_price_pct: -3,   // also out of range
            edge_pct: 10,
            score: 75,
            rationale: 'test rationale',
            key_risk: 'test risk',
            flags: [],
            confidence: 'HIGH',
          }],
          screened_out: [],
          session_notes: '',
        }),
      }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.opportunities.length).toBeGreaterThan(0)
  })

  it('surfaces the actual failure reason when Claude truly returns bad data', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets(openMarkets)
    // Wrong TYPE (a string where the schema requires a number) — this is a
    // genuine malformation, not a range issue, and should still fail, but
    // with a diagnosable message instead of the old generic one.
    mockCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          opportunities: [{
            ticker: 'FED-DEC',
            title: 'Will Fed cut in December?',
            direction: 'YES',
            my_estimate_pct: 'seventy-five', // wrong type
            market_price_pct: 45,
            edge_pct: 10,
            score: 75,
            rationale: 'test rationale',
            key_risk: 'test risk',
            flags: [],
            confidence: 'HIGH',
          }],
          screened_out: [],
          session_notes: '',
        }),
      }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.error).toContain('my_estimate_pct')
  })

  it('returns opportunities, screened_out, and markets_scanned on success', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets(openMarkets)
    mockClaudeScan([{ ticker: 'FED-DEC', estimate: 75 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data.opportunities)).toBe(true)
    expect(Array.isArray(data.screened_out)).toBe(true)
    expect(typeof data.session_notes).toBe('string')
    expect(typeof data.markets_scanned).toBe('number')
    expect(data.markets_scanned).toBeGreaterThan(0)
  })

  it('scales the Claude output-token budget with market count instead of a flat ceiling', async () => {
    // Regression: a flat max_tokens truncated responses on batches as small as
    // 30 markets ("unexpected format" / stop_reason max_tokens) because the
    // ceiling didn't account for one JSON entry (rationale/key_risk or a
    // screened_out reason) per market, plus adaptive-thinking tokens per market.
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    // 30 distinct markets — the exact batch size that triggered the bug.
    const manyMarkets = Array.from({ length: 30 }, (_, i) => ({
      ticker: `MKT-${i}`,
      title: `Market number ${i}`,
      yes_ask: 40,
      yes_bid: 38,
      volume_24h: 5000 + i,
      category: 'Economics',
    }))
    mockKalshiMarkets(manyMarkets)
    mockClaudeScan([{ ticker: 'MKT-0', estimate: 75 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 30 })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // The request actually sent to the API must scale well above the old flat
    // 32000 ceiling — this is the direct fix for the reported truncation.
    const sentParams = mockCreate.mock.calls[0][0]
    expect(sentParams.max_tokens).toBeGreaterThan(32000)
    expect(sentParams.max_tokens).toBeLessThanOrEqual(128000)
  })

  it('runs the scanner at medium effort (coarse triage, not deep analysis) to cut thinking tokens', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets(openMarkets)
    mockClaudeScan([{ ticker: 'FED-DEC', estimate: 75 }])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    await POST(makeRequest({ limit: 15 }))

    // The scan is triage — its estimates are shrunk toward market and
    // re-checked in code, so it must not burn 'high'-effort thinking tokens.
    const sentParams = mockCreate.mock.calls[0][0]
    expect(sentParams.output_config.effort).toBe('medium')
  })
})
