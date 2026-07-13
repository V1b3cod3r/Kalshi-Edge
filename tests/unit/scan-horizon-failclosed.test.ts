import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Regression coverage for a REAL-MONEY incident: the resolution-horizon
// filter originally FAILED OPEN (fell back to the uncapped pool when the cap
// matched nothing), and live autopilot then bought contracts resolving in
// 2029-2035 — precisely what the 45-day cap exists to prevent. The corrected
// contract is:
//   1. The fetch itself passes max_close_ts so far-dated markets never
//      dominate the paginated pool in the first place.
//   2. If the cap still matches nothing in a non-empty pool, the scan FAILS
//      CLOSED with a clear error — it never silently widens the universe.

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      stream: (params: any) => ({ finalMessage: () => mockCreate(params) }),
    }
    constructor(_opts: any) {}
  },
}))

vi.mock('@/lib/signals', () => ({
  getSignalsForMarkets: vi.fn().mockResolvedValue(new Map()),
  formatSignals: vi.fn().mockReturnValue(''),
}))
vi.mock('@/lib/search', () => ({
  getWebContextForMarkets: vi.fn().mockResolvedValue(new Map()),
  formatWebContext: vi.fn().mockReturnValue(''),
}))

function mockClaudeScan() {
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ opportunities: [], screened_out: [], session_notes: '' }) }],
  })
}

let fetchMock: ReturnType<typeof vi.fn>
function mockKalshiMarkets(markets: any[]) {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ markets, cursor: null }),
    text: () => Promise.resolve(''),
  })
  vi.stubGlobal('fetch', fetchMock)
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  mockCreate.mockReset()
  vi.unstubAllGlobals()

  const { getSettings, saveSettings } = await import('@/lib/storage')
  const settings = getSettings()
  settings.kalshi_api_key = 'kx-test-key'
  settings.anthropic_api_key = 'sk-ant-test-key'
  saveSettings(settings)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function farFutureMarkets(n: number) {
  const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString()
  return Array.from({ length: n }, (_, i) => ({
    ticker: `MKT-${i}`,
    title: `Market ${i}`,
    yes_ask: 40,
    yes_bid: 38,
    volume_24h: 1000 + i,
    category: 'Economics',
    close_time: farFuture,
  }))
}

describe('runScan — resolution horizon (REAL MONEY: must fail closed, never open)', () => {
  it('passes max_close_ts to the Kalshi fetch when a horizon is set', async () => {
    const nearTerm = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    mockKalshiMarkets([
      { ticker: 'NEAR', title: 'Near market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: nearTerm },
    ])
    mockClaudeScan()

    const { runScan } = await import('@/lib/scan')
    await runScan({ limit: 15, max_days_to_resolution: 45, logPredictions: false })

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('max_close_ts=')
    // The bound must be ~45 days out from now (allow an hour of slack)
    const url = new URL(calledUrl)
    const maxCloseTs = Number(url.searchParams.get('max_close_ts'))
    const expected = Math.floor(Date.now() / 1000) + 45 * 86400
    expect(Math.abs(maxCloseTs - expected)).toBeLessThan(3600)
  })

  it('does NOT pass max_close_ts when no horizon is set (manual scanner keeps the full universe)', async () => {
    const nearTerm = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    mockKalshiMarkets([
      { ticker: 'NEAR', title: 'Near market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: nearTerm },
    ])
    mockClaudeScan()

    const { runScan } = await import('@/lib/scan')
    await runScan({ limit: 15, logPredictions: false })

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).not.toContain('max_close_ts=')
  })

  it('FAILS CLOSED when every fetched market resolves beyond the horizon — never trades the uncapped pool', async () => {
    mockKalshiMarkets(farFutureMarkets(30))
    mockClaudeScan()

    const { runScan } = await import('@/lib/scan')

    await expect(
      runScan({ limit: 30, max_days_to_resolution: 45, logPredictions: false })
    ).rejects.toThrow(/beyond the 45-day horizon/)

    // And Claude must never have been called — no tokens spent, no
    // opportunities produced, nothing for a buy loop to act on.
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('still applies the cap normally when at least one market qualifies', async () => {
    const nearTerm = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString()
    mockKalshiMarkets([
      { ticker: 'NEAR', title: 'Near-term market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: nearTerm },
      { ticker: 'FAR', title: 'Far-future market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: farFuture },
    ])
    mockClaudeScan()

    const { runScan } = await import('@/lib/scan')
    const result = await runScan({ limit: 15, max_days_to_resolution: 45, logPredictions: false })

    expect(result.markets_scanned).toBe(1)
  })
})
