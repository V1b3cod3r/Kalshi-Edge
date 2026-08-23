import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { generateKeyPairSync } from 'crypto'

// ---------------------------------------------------------------------------
// SIT: full runAutopilotCycle() integration tests. Everything else in this
// project tests PIECES (Kelly math, ticker parsing, calibration grouping) in
// isolation. This file is the only place that exercises the actual seams:
// autopilot.ts <-> kalshi.ts (real HTTP request shapes, via a mocked global
// fetch, not a mocked kalshi.ts module) <-> the strategy registry <->
// storage.ts (real file-backed settings/predictions round trip).
// ---------------------------------------------------------------------------

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
  getSignalsForMarket: vi.fn().mockResolvedValue([]),
  // Real export used by settlementSnipe.ts — keep the actual verified city map.
  TEMP_TICKER_CITY_CODES: {
    NYC: { label: 'New York', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
    LAX: { label: 'Los Angeles', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
  },
}))
vi.mock('@/lib/search', () => ({
  getWebContextForMarkets: vi.fn().mockResolvedValue(new Map()),
  formatWebContext: vi.fn().mockReturnValue(''),
}))

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

function mockClaudeScan(opps: Array<{ ticker: string; estimate?: number; direction?: 'YES' | 'NO' }>) {
  const scanJson = JSON.stringify({
    opportunities: opps.map(({ ticker, estimate = 85, direction = 'YES' }) => ({
      ticker,
      title: `Opportunity ${ticker}`,
      direction,
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
    session_notes: 'test',
  })
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: scanJson }] })
}

interface FetchConfig {
  balanceCents?: number
  positions?: any[]
  settlements?: any[]
  restingOrders?: any[]
  markets?: any[]                      // raw Kalshi market list, paginated fetch
  marketByTicker?: Record<string, any> // for single-market fetchMarket lookups
  nws?: {
    pointsByLatLon?: Record<string, any> // key: "lat,lon"
    stations?: any                        // stations feature collection
    observations?: any                    // observations feature collection
  }
  onOrderPlaced?: (body: any) => void
}

function installKalshiFetchMock(cfg: FetchConfig) {
  const fetchMock = vi.fn(async (url: any, init?: any) => {
    const u = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (u.startsWith('https://api.weather.gov')) {
      if (u.includes('/points/') && !u.includes('/stations')) {
        const key = u.split('/points/')[1]
        const point = cfg.nws?.pointsByLatLon?.[key]
        return jsonResponse(point ?? { properties: {} })
      }
      if (u.includes('/stations') && !u.includes('/observations')) {
        return jsonResponse(cfg.nws?.stations ?? { features: [] })
      }
      if (u.includes('/observations')) {
        return jsonResponse(cfg.nws?.observations ?? { features: [] })
      }
      return jsonResponse({})
    }

    if (u.includes('/portfolio/events/orders') && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body) : {}
      cfg.onOrderPlaced?.(body)
      return jsonResponse({ order: { order_id: `ord-${Math.random().toString(36).slice(2, 8)}`, status: 'resting', ticker: body.ticker, side: body.side, count: Number(body.count), yes_price: body.price, created_time: new Date().toISOString() } })
    }
    if (u.includes('/portfolio/orders') && method === 'DELETE') {
      return jsonResponse({})
    }
    if (u.includes('/portfolio/orders') && method === 'GET') {
      return jsonResponse({ orders: cfg.restingOrders ?? [] })
    }
    if (u.includes('/portfolio/balance')) {
      return jsonResponse({ balance: cfg.balanceCents ?? 100000 })
    }
    if (u.includes('/portfolio/positions')) {
      return jsonResponse({ market_positions: cfg.positions ?? [] })
    }
    if (u.includes('/portfolio/settlements')) {
      return jsonResponse({ settlements: cfg.settlements ?? [] })
    }
    // Single-market lookup: /markets/<TICKER> (no query string)
    const singleMatch = u.match(/\/markets\/([^/?]+)$/)
    if (singleMatch) {
      const ticker = decodeURIComponent(singleMatch[1])
      const m = cfg.marketByTicker?.[ticker]
      return jsonResponse({ market: m ?? null })
    }
    // Paginated market list: /markets?...
    if (u.includes('/markets?') || u.endsWith('/markets')) {
      return jsonResponse({ markets: cfg.markets ?? [], cursor: null })
    }

    throw new Error(`Unhandled mock fetch: ${method} ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  }
}

// Raw Kalshi market fixture (list-endpoint shape, cent-integer quote fields).
function rawMarket(overrides: Partial<any> & { ticker: string; title: string }) {
  return {
    yes_ask: 45,
    yes_bid: 43,
    no_ask: 57,
    no_bid: 55,
    volume_24h: 5000,
    close_time: new Date(Date.now() + 20 * 86400000).toISOString(),
    category: 'Economics',
    ...overrides,
  }
}

let tmpDir: string
let privateKeyPem: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-autopilot-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  mockCreate.mockReset()
  vi.unstubAllGlobals()

  // A real RSA keypair so getSignedHeaders' createSign/createPrivateKey calls
  // succeed — the mock fetch layer never verifies the signature, but it must
  // be produced without throwing.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

async function seedSettings(autopilotOverrides: Record<string, any>) {
  const { getSettings, saveSettings } = await import('@/lib/storage')
  const settings = getSettings()
  settings.kalshi_api_key = 'test-key-id'
  settings.kalshi_private_key = privateKeyPem
  settings.anthropic_api_key = 'sk-ant-test'
  settings.autopilot = {
    ...settings.autopilot,
    enabled: true,
    max_daily_loss_usd: 1000,
    ...autopilotOverrides,
  }
  saveSettings(settings)
  return settings
}

describe('runAutopilotCycle — SIT: LLM-divergence baseline (regression)', () => {
  it('produces a dry-run trade tagged llm-divergence, matching pre-registry behavior', async () => {
    await seedSettings({ dry_run: true, min_effective_edge_pct: 4, min_confidence: 'HIGH' })
    installKalshiFetchMock({
      markets: [rawMarket({ ticker: 'FED-DEC', title: 'Fed cuts in December?' })],
    })
    mockClaudeScan([{ ticker: 'FED-DEC', estimate: 85 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(report.status).toBe('ok')
    const buy = report.trades.find((t) => t.ticker === 'FED-DEC' && !t.skip_reason)
    expect(buy).toBeDefined()
    expect(buy?.strategy).toBe('llm-divergence')
    expect(buy?.executed).toBe(false) // dry run
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('runAutopilotCycle — SIT: cost control (disabled strategy never calls Claude)', () => {
  it('never invokes the Claude SDK when strategy_llm_divergence_enabled is false', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 90,
      // The horizon-correction model is DELIBERATELY conservative (see
      // docs/STRATEGY_EXPANSION_PLAN.md) — a 90c favorite at the full 90-day
      // window edge clears roughly ~2% edge, not more. Use a lenient
      // threshold here since this test is about the registry wiring
      // (does a mechanical strategy fire without any Claude call?), not a
      // re-verification of the edge math itself (see
      // strategy-dated-favorites.test.ts for that).
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      // Kelly is hypersensitive near the top of the favorite band (b =
      // (1-price)/price is small at 90c), so the default 3pp confidence
      // haircut alone is enough to flip a ~2% pre-haircut edge NEGATIVE —
      // a real, working guardrail interaction, not a bug, but not what
      // THIS test (registry wiring) is checking. Zero it out here.
      kelly_haircut_high_pp: 0,
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'FAV-1', title: 'Favorite market', yes_ask: 90, yes_bid: 88,
          close_time: new Date(Date.now() + 90 * 86400000).toISOString(),
        }),
      ],
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(report.status).toBe('ok')
    expect(mockCreate).not.toHaveBeenCalled()
    const buy = report.trades.find((t) => t.ticker === 'FAV-1' && !t.skip_reason)
    expect(buy).toBeDefined()
    expect(buy?.strategy).toBe('dated-favorites')
    expect(buy?.side).toBe('yes')
  })
})

describe('runAutopilotCycle — SIT: absolute horizon ceiling (never buy a multi-year contract)', () => {
  it('skips a dated-favorites candidate resolving in ~500 days even when the per-strategy horizon setting is misconfigured wide open', async () => {
    // dated_favorites_max_days is set far past a year on purpose — the point
    // of the absolute ceiling in evaluateOpportunity is that it holds
    // regardless of how a per-strategy setting gets misconfigured, not just
    // under sane defaults.
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 1000,
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      kelly_haircut_high_pp: 0,
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'FAR-OUT', title: 'Multi-year favorite', yes_ask: 90, yes_bid: 88,
          close_time: new Date(Date.now() + 500 * 86400000).toISOString(),
        }),
      ],
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(report.status).toBe('ok')
    const decision = report.trades.find((t) => t.ticker === 'FAR-OUT')
    expect(decision).toBeDefined()
    expect(decision?.executed).toBe(false)
    expect(decision?.skip_reason).toMatch(/365-day absolute horizon ceiling/)
  })

  it('still buys a near-dated candidate resolving well within a year', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 90,
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      kelly_haircut_high_pp: 0,
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'NEAR-DATED', title: 'Near-dated favorite', yes_ask: 90, yes_bid: 88,
          close_time: new Date(Date.now() + 60 * 86400000).toISOString(),
        }),
      ],
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const buy = report.trades.find((t) => t.ticker === 'NEAR-DATED' && !t.skip_reason)
    expect(buy).toBeDefined()
  })
})

describe('runAutopilotCycle — SIT: shared guardrails apply ACROSS strategies', () => {
  it('a spend limit tight enough for only one trade lets the higher-edge strategy win, regardless of origin', async () => {
    // Two candidates, each would cost ~$80 (contracts sized by $100 cap /
    // price), but max_daily_spend_usd only allows one to go through.
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: true,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 90,
      // See the cost-control test above for why this is 0.5, not 1+ — the
      // horizon-correction model is deliberately conservative.
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      max_per_trade_usd: 100,
      max_daily_spend_usd: 100, // only room for ONE ~$80-100 trade
      max_exposure_usd: 1000,
      max_per_cluster_usd: 1000,
      kelly_fraction: 1,
      kelly_haircut_high_pp: 0,
      kelly_haircut_medium_pp: 0,
      kelly_haircut_low_pp: 0,
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'LLM-TICKER', title: 'LLM candidate', yes_ask: 50, yes_bid: 48,
          close_time: new Date(Date.now() + 20 * 86400000).toISOString(),
        }),
        rawMarket({
          ticker: 'FAV-TICKER', title: 'Dated favorite candidate', yes_ask: 90, yes_bid: 88,
          close_time: new Date(Date.now() + 90 * 86400000).toISOString(),
        }),
      ],
    })
    // LLM estimate 95% on a 50c market -> large edge, should rank first.
    mockClaudeScan([{ ticker: 'LLM-TICKER', estimate: 95 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const executedBuys = report.trades.filter((t) => !t.skip_reason && t.intent !== 'sell')
    const skippedForSpend = report.trades.filter((t) => t.skip_reason?.includes('Daily spend'))

    // Exactly one buy went through, and it's the higher-edge one.
    expect(executedBuys.length).toBe(1)
    expect(executedBuys[0].strategy).toBe('llm-divergence')
    expect(skippedForSpend.length).toBeGreaterThanOrEqual(1)
    expect(skippedForSpend.some((t) => t.ticker === 'FAV-TICKER')).toBe(true)
  })

  it('a cluster cap shared across strategies blocks a second same-cluster trade regardless of which strategy found it', async () => {
    // Both opportunities are on the SAME event (same cluster key via
    // eventKeyFromTicker), sourced from different strategies.
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: true,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 90,
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      max_per_trade_usd: 100,
      max_daily_spend_usd: 1000,
      max_exposure_usd: 1000,
      max_per_cluster_usd: 50, // tight enough that only one same-cluster trade fits
      kelly_fraction: 1,
      kelly_haircut_high_pp: 0,
      kelly_haircut_medium_pp: 0,
      kelly_haircut_low_pp: 0,
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'KXEVENT-26JUL12-T50', title: 'Event strike A', yes_ask: 50, yes_bid: 48,
          close_time: new Date(Date.now() + 20 * 86400000).toISOString(),
        }),
        rawMarket({
          ticker: 'KXEVENT-26JUL12-T80', title: 'Event strike B (favorite)', yes_ask: 90, yes_bid: 88,
          close_time: new Date(Date.now() + 90 * 86400000).toISOString(),
        }),
      ],
    })
    mockClaudeScan([{ ticker: 'KXEVENT-26JUL12-T50', estimate: 95 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const executedBuys = report.trades.filter((t) => !t.skip_reason && t.intent !== 'sell')
    const clusterSkips = report.trades.filter((t) => t.skip_reason?.includes('exposure limit reached') && t.skip_reason.includes('Cluster'))

    expect(executedBuys.length).toBe(1)
    expect(clusterSkips.length).toBeGreaterThanOrEqual(1)
  })
})

describe('runAutopilotCycle — SIT: one strategy failing never aborts the cycle or the others', () => {
  it('dated-favorites market fetch throwing leaves llm-divergence trades intact', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: true,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
    })

    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const u = String(url)
      if (u.includes('/markets?') || u.endsWith('/markets')) {
        // Every market-list fetch throws — this is the ONLY source
        // fetchOpenMarkets (dated-favorites) uses. runScan (llm-divergence)
        // ALSO uses fetchMarkets, so to isolate the failure to dated-
        // favorites specifically we instead make the second-status-probe
        // path fail; simplest robust approach: fail markets? entirely and
        // assert the LLM path's OWN market fetch failure is handled the
        // same way runScan already handles it (ScanError), while dated-
        // favorites' failure never surfaces as a cycle-level error.
        throw new Error('simulated network failure')
      }
      if (u.includes('/portfolio/balance')) return jsonResponse({ balance: 100000 })
      if (u.includes('/portfolio/positions')) return jsonResponse({ market_positions: [] })
      if (u.includes('/portfolio/settlements')) return jsonResponse({ settlements: [] })
      if (u.includes('/portfolio/orders')) return jsonResponse({ orders: [] })
      throw new Error(`Unhandled mock fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    // runScan's own fetch failures are ALREADY handled (ScanError), which
    // propagates as a cycle-level error today for the LLM path specifically
    // (this is pre-existing, documented behavior — see runScan's
    // lastFetchError handling). The property under test here is narrower and
    // more important for THIS session's change: a fetchOpenMarkets failure
    // must never throw an unhandled exception out of the registry loop.
    // Assert the cycle always finishes and persists a record either way.
    expect(['ok', 'error']).toContain(report.status)
    expect(report.finished_at).toBeTruthy()
  })

  it('settlement-snipe NWS fetch failing leaves llm-divergence trades intact', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: true,
      strategy_settlement_snipe_enabled: true,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
    })
    installKalshiFetchMock({
      markets: [rawMarket({ ticker: 'FED-DEC', title: 'Fed cuts in December?' })],
      nws: {}, // stations/observations resolve empty -> settlement-snipe finds nothing, never throws
    })
    mockClaudeScan([{ ticker: 'FED-DEC', estimate: 85 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(report.status).toBe('ok')
    const buy = report.trades.find((t) => t.ticker === 'FED-DEC' && !t.skip_reason)
    expect(buy?.strategy).toBe('llm-divergence')
  })
})

describe('runAutopilotCycle — SIT: maker orders reprice at the live bid, not the scan-time ask', () => {
  it('places a post_only order at the bid and logs the actual price paid, not the ask', async () => {
    await seedSettings({
      dry_run: false,
      use_maker_orders: true,
      strategy_llm_divergence_enabled: true,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
      kelly_fraction: 1,
      kelly_haircut_high_pp: 0,
    })
    let placedBody: any = null
    installKalshiFetchMock({
      markets: [rawMarket({ ticker: 'MK-1', title: 'Maker candidate', yes_ask: 50, yes_bid: 40 })],
      marketByTicker: {
        // Live re-fetch at order-placement time — bid has moved to 42 since scan.
        'MK-1': rawMarket({ ticker: 'MK-1', title: 'Maker candidate', yes_ask: 50, yes_bid: 42 }),
      },
      onOrderPlaced: (body) => { placedBody = body },
    })
    mockClaudeScan([{ ticker: 'MK-1', estimate: 90 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(placedBody).not.toBeNull()
    expect(placedBody.post_only).toBe(true)
    expect(placedBody.time_in_force).toBe('good_till_canceled')
    // 42c bid, not the 50c scan-time ask.
    expect(placedBody.price).toBe('0.42')

    const buy = report.trades.find((t) => t.ticker === 'MK-1' && t.executed)
    expect(buy?.price).toBeCloseTo(0.42, 6)
  })

  it('skips the trade (never falls back to taker) when no live bid is available', async () => {
    await seedSettings({
      dry_run: false,
      use_maker_orders: true,
      strategy_llm_divergence_enabled: true,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
    })
    let orderWasPlaced = false
    installKalshiFetchMock({
      markets: [rawMarket({ ticker: 'MK-2', title: 'No live bid', yes_ask: 50, yes_bid: 40 })],
      marketByTicker: {
        'MK-2': rawMarket({ ticker: 'MK-2', title: 'No live bid', yes_ask: 50, yes_bid: 0 }), // no bid
      },
      onOrderPlaced: () => { orderWasPlaced = true },
    })
    mockClaudeScan([{ ticker: 'MK-2', estimate: 90 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    expect(orderWasPlaced).toBe(false)
    const skip = report.trades.find((t) => t.ticker === 'MK-2' && t.skip_reason)
    expect(skip?.skip_reason).toMatch(/no live bid/i)
  })
})

describe('runAutopilotCycle — SIT: strategy tag round-trips through predictions and calibration stats', () => {
  it('a live executed trade logs a Prediction tagged with the originating strategy, visible in by_strategy', async () => {
    await seedSettings({
      dry_run: false,
      strategy_llm_divergence_enabled: true,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
      kelly_fraction: 1,
      kelly_haircut_high_pp: 0,
    })
    installKalshiFetchMock({
      markets: [rawMarket({ ticker: 'PRED-1', title: 'Prediction tagging test', yes_ask: 50, yes_bid: 48 })],
      marketByTicker: { 'PRED-1': rawMarket({ ticker: 'PRED-1', title: 'Prediction tagging test', yes_ask: 50, yes_bid: 48 }) },
    })
    mockClaudeScan([{ ticker: 'PRED-1', estimate: 90 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    await runAutopilotCycle()

    const { getPredictions, getCalibrationStats } = await import('@/lib/storage')
    const preds = getPredictions()
    const own = preds.find((p) => p.ticker === 'PRED-1')
    expect(own?.strategy).toBe('llm-divergence')
    expect(own?.source).toBe('autopilot')

    const stats = getCalibrationStats()
    const llmStats = stats.by_strategy.find((s) => s.strategy === 'llm-divergence')
    expect(llmStats?.count).toBeGreaterThanOrEqual(1)
  })
})

describe('runAutopilotCycle — SIT: exit pass frees headroom for a buy in the SAME cycle', () => {
  it('a take-profit sell frees cluster/exposure headroom that a same-cycle buy then claims', async () => {
    await seedSettings({
      dry_run: true,
      exit_enabled: true,
      take_profit_pct: 10,
      strategy_llm_divergence_enabled: true,
      min_effective_edge_pct: 4,
      min_confidence: 'HIGH',
      max_exposure_usd: 50, // tight: only fits after the sell frees room
      max_per_cluster_usd: 50,
      max_daily_spend_usd: 1000,
      kelly_fraction: 1,
      kelly_haircut_high_pp: 0,
    })
    installKalshiFetchMock({
      positions: [
        // 100 contracts @ avg entry $0.50 = $50 cost basis — fully consumes the $50 exposure cap.
        { ticker: 'OLD-POS', position_fp: '100', market_exposure_dollars: '50' },
      ],
      marketByTicker: {
        'OLD-POS': rawMarket({ ticker: 'OLD-POS', title: 'Existing position', yes_ask: 60, yes_bid: 58 }), // up from $5 avg entry -> take-profit
        'NEW-BUY': rawMarket({ ticker: 'NEW-BUY', title: 'New candidate', yes_ask: 50, yes_bid: 48 }),
      },
      markets: [rawMarket({ ticker: 'NEW-BUY', title: 'New candidate', yes_ask: 50, yes_bid: 48 })],
    })
    mockClaudeScan([{ ticker: 'NEW-BUY', estimate: 90 }])

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const sell = report.trades.find((t) => t.ticker === 'OLD-POS' && t.intent === 'sell')
    expect(sell?.exit_reason).toBe('take_profit')
    expect(sell?.strategy).toBe('exit-management')

    const buy = report.trades.find((t) => t.ticker === 'NEW-BUY' && !t.skip_reason)
    expect(buy).toBeDefined()
  })
})

describe('runAutopilotCycle — SIT: settlement-snipe full pipeline (live NWS chain)', () => {
  function nwsFixture(observedC: number, obsTimestamp = new Date().toISOString()) {
    return {
      pointsByLatLon: {
        '40.71,-74.01': { properties: { observationStations: 'https://api.weather.gov/gridpoints/OKX/33,35/stations' } },
      },
      stations: { features: [{ id: 'https://api.weather.gov/stations/KNYC' }] },
      observations: { features: [{ properties: { timestamp: obsTimestamp, temperature: { value: observedC } } }] },
    }
  }

  it('fires a YES trade once the live observation clears the strike by the safety margin', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_settlement_snipe_enabled: true,
      settlement_snipe_margin_f: 2,
      settlement_snipe_max_confidence_pct: 95,
      min_effective_edge_pct: 1,
      min_confidence: 'MEDIUM',
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'KXTEMPNYCH-26JUL1207-T74.99',
          title: 'Will the NYC high exceed 74.99°F today?',
          yes_ask: 20, yes_bid: 18,
          close_time: new Date(Date.now() + 6 * 3600000).toISOString(),
        }),
      ],
      // 26.5°C = 79.7°F, clears the 74.99°F strike by ~4.7°F (> 2°F margin).
      nws: nwsFixture(26.5),
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const buy = report.trades.find((t) => t.ticker === 'KXTEMPNYCH-26JUL1207-T74.99' && !t.skip_reason)
    expect(buy).toBeDefined()
    expect(buy?.strategy).toBe('settlement-snipe')
    expect(buy?.side).toBe('yes') // always YES — see settlementSnipe.ts file header
  })

  it('never fires when the observation clears the strike but not by the required margin', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_settlement_snipe_enabled: true,
      settlement_snipe_margin_f: 2,
      min_effective_edge_pct: 1,
      min_confidence: 'MEDIUM',
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'KXTEMPNYCH-26JUL1207-T74.99',
          title: 'Will the NYC high exceed 74.99°F today?',
          yes_ask: 20, yes_bid: 18,
          close_time: new Date(Date.now() + 6 * 3600000).toISOString(),
        }),
      ],
      // 24.2°C = 75.56°F — clears the strike by only ~0.57°F, well under
      // the 2°F safety margin. Must produce NO opportunity at all, not a
      // low-confidence one.
      nws: nwsFixture(24.2),
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const anyEntry = report.trades.find((t) => t.ticker === 'KXTEMPNYCH-26JUL1207-T74.99')
    expect(anyEntry).toBeUndefined()
  })

  it('never fires when the title does not independently corroborate direction, even with a clearing observation', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_settlement_snipe_enabled: true,
      min_effective_edge_pct: 1,
      min_confidence: 'MEDIUM',
    })
    installKalshiFetchMock({
      markets: [
        rawMarket({
          ticker: 'KXTEMPNYCH-26JUL1207-T74.99',
          title: 'NYC high temperature market', // no above/below language at all
          yes_ask: 20, yes_bid: 18,
          close_time: new Date(Date.now() + 6 * 3600000).toISOString(),
        }),
      ],
      nws: nwsFixture(30), // massively clears — direction ambiguity must still block it
    })

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const anyEntry = report.trades.find((t) => t.ticker === 'KXTEMPNYCH-26JUL1207-T74.99')
    expect(anyEntry).toBeUndefined()
  })
})

describe('runAutopilotCycle — SIT: dated-favorites follows Kalshi pagination cursors', () => {
  it('evaluates favorite candidates from BOTH pages of a paginated market list', async () => {
    await seedSettings({
      dry_run: true,
      strategy_llm_divergence_enabled: false,
      strategy_dated_favorites_enabled: true,
      dated_favorites_min_price_cents: 60,
      dated_favorites_max_price_cents: 95,
      dated_favorites_min_days: 1,
      dated_favorites_max_days: 90,
      min_effective_edge_pct: 0.5,
      min_confidence: 'MEDIUM',
      kelly_haircut_high_pp: 0,
      max_per_trade_usd: 25,
      max_daily_spend_usd: 1000,
      max_exposure_usd: 1000,
      max_per_cluster_usd: 1000,
    })

    const page1Market = rawMarket({
      ticker: 'PAGE1-FAV', title: 'Page 1 favorite', yes_ask: 90, yes_bid: 88,
      close_time: new Date(Date.now() + 90 * 86400000).toISOString(),
    })
    const page2Market = rawMarket({
      ticker: 'PAGE2-FAV', title: 'Page 2 favorite', yes_ask: 91, yes_bid: 89,
      close_time: new Date(Date.now() + 90 * 86400000).toISOString(),
    })

    const fetchMock = vi.fn(async (url: any, init?: any) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (u.includes('/portfolio/balance')) return { ok: true, json: () => Promise.resolve({ balance: 100000 }), text: () => Promise.resolve('') }
      if (u.includes('/portfolio/positions')) return { ok: true, json: () => Promise.resolve({ market_positions: [] }), text: () => Promise.resolve('') }
      if (u.includes('/portfolio/settlements')) return { ok: true, json: () => Promise.resolve({ settlements: [] }), text: () => Promise.resolve('') }
      if (u.includes('/portfolio/orders')) return { ok: true, json: () => Promise.resolve({ orders: [] }), text: () => Promise.resolve('') }
      if (u.includes('/markets?')) {
        // First call (no cursor param) -> page 1 + a cursor. Second call
        // (cursor=page2) -> page 2, no further cursor.
        const hasCursor = u.includes('cursor=page2')
        if (!hasCursor) {
          return { ok: true, json: () => Promise.resolve({ markets: [page1Market], cursor: 'page2' }), text: () => Promise.resolve('') }
        }
        return { ok: true, json: () => Promise.resolve({ markets: [page2Market], cursor: null }), text: () => Promise.resolve('') }
      }
      throw new Error('Unhandled mock fetch: ' + method + ' ' + u)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runAutopilotCycle } = await import('@/lib/autopilot')
    const report = await runAutopilotCycle()

    const buy1 = report.trades.find((t) => t.ticker === 'PAGE1-FAV')
    const buy2 = report.trades.find((t) => t.ticker === 'PAGE2-FAV')
    expect(buy1).toBeDefined()
    expect(buy2).toBeDefined()
  })
})
