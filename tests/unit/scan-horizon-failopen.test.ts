import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Regression coverage for a real production bug: a live autopilot run reported
// "3000 fetched → 3000 unexpired → 0 resolving within 45d" — the resolution-
// horizon filter eliminated 100% of an otherwise-healthy market pool, breaking
// every scan. Root cause (Kalshi's resolution_date possibly reflecting a
// series-level date rather than the specific market's actual settlement, or a
// status-probe bias) isn't confirmable without live Kalshi access, so the fix
// is defensive: a horizon filter that would zero out an entire non-empty pool
// falls back to the uncapped pool instead of breaking the scan.

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

function mockKalshiMarkets(markets: any[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ markets, cursor: null }),
    text: () => Promise.resolve(''),
  }))
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

// All markets resolve far in the future — reproduces the exact reported bug:
// a non-empty, otherwise-healthy pool where the horizon cap matches nothing.
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

describe('runScan — resolution-horizon fail-open', () => {
  it('does NOT return zero markets when the horizon cap matches nothing in a non-empty pool', async () => {
    mockKalshiMarkets(farFutureMarkets(30))
    mockClaudeScan()

    const { getSettings, saveSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    const { runScan } = await import('@/lib/scan')

    // Every market resolves ~400 days out; a 45-day cap would eliminate 100%.
    const result = await runScan({ limit: 30, max_days_to_resolution: 45, logPredictions: false })

    // Must NOT throw ScanError('no_markets', ...) — the fallback must kick in.
    expect(result.markets_scanned).toBeGreaterThan(0)
  })

  it('surfaces the fallback visibly in session_notes', async () => {
    mockKalshiMarkets(farFutureMarkets(10))
    mockClaudeScan()

    const { getSettings, saveSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    const { runScan } = await import('@/lib/scan')
    const result = await runScan({ limit: 10, max_days_to_resolution: 45, logPredictions: false })

    expect(result.session_notes).toContain('resolution horizon filter')
    expect(result.session_notes).toContain('skipped')
  })

  it('still applies the cap normally when at least one market qualifies (no false fallback)', async () => {
    const nearTerm = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString()
    mockKalshiMarkets([
      { ticker: 'NEAR', title: 'Near-term market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: nearTerm },
      { ticker: 'FAR', title: 'Far-future market', yes_ask: 40, yes_bid: 38, volume_24h: 5000, close_time: farFuture },
    ])
    mockClaudeScan()

    const { getSettings, saveSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    const { runScan } = await import('@/lib/scan')
    const result = await runScan({ limit: 15, max_days_to_resolution: 45, logPredictions: false })

    // Cap works normally — only the near-term market survives, no fallback note.
    expect(result.markets_scanned).toBe(1)
    expect(result.session_notes).not.toContain('resolution horizon filter')
  })
})
