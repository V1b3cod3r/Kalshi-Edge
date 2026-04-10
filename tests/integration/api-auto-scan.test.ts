import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mockCreate }
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

// Return valid scanner JSON from Claude (ticker must match the market being tested)
function mockClaudeScan(tickers: string[]) {
  const scanJson = JSON.stringify({
    opportunities: tickers.map(ticker => ({
      ticker,
      action: 'BET',
      direction: 'YES',
      score: 75,
      edge: 0.10,
      rationale: 'test',
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
    expect(data.error).toContain('No markets found')
  })

  it('normalizes Kalshi cent-prices to decimal', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'FED-DEC', title: 'Fed cut December', yes_ask: 45, yes_bid: 43, volume_24h: 5000 },
    ])
    mockClaudeScan(['FED-DEC'])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    // yes_price uses ask price: 45 cents → 0.45 decimal
    expect(data.opportunities[0].yes_price).toBeCloseTo(0.45, 2)
    expect(data.opportunities[0].no_price).toBeCloseTo(0.55, 2)
  })

  it('falls back to last_price when yes_ask and yes_bid are zero', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    // yes_ask=0, yes_bid=0, but last_price=50 (still in cents)
    mockKalshiMarkets([
      { ticker: 'FALLBACK', title: 'Fallback price test', yes_ask: 0, yes_bid: 0, last_price: 50, volume_24h: 2000 },
    ])
    mockClaudeScan(['FALLBACK'])

    vi.resetModules()
    const { POST } = await import('@/app/api/auto-scan/route')

    const req = makeRequest({ limit: 15 })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.opportunities[0].yes_price).toBeCloseTo(0.5, 2)
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
    mockClaudeScan(['NORMAL'])

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
    mockClaudeScan(['NORMAL'])

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

  it('applies min_volume filter', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets([
      { ticker: 'LOW-VOL', title: 'Low volume', yes_ask: 45, yes_bid: 43, volume_24h: 100 },
      { ticker: 'HIGH-VOL', title: 'High volume', yes_ask: 55, yes_bid: 53, volume_24h: 5000 },
    ])
    mockClaudeScan(['HIGH-VOL'])

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
    mockClaudeScan(['HIGH', 'MED'])

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
  })

  it('returns opportunities, screened_out, and markets_scanned on success', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockKalshiMarkets(openMarkets)
    mockClaudeScan(['FED-DEC'])

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
})
