import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KalshiAuth } from '@/lib/kalshi'

// RSA signing requires real crypto — stub it out for unit tests
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actual,
    // normalizePem calls createPrivateKey; mock it so fake test PEMs don't throw
    createPrivateKey: vi.fn().mockReturnValue({ type: 'private', asymmetricKeyType: 'rsa' }),
    createSign: () => ({
      update: vi.fn(),
      end: vi.fn(),
      sign: vi.fn().mockReturnValue('mock-signature'),
    }),
  }
})

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve('')),
  }))
}

const TEST_AUTH: KalshiAuth = {
  keyId: 'test-key-id',
  privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
}

describe('fetchMarkets', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('calls the correct endpoint with no params', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ markets: [], cursor: null }),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    await fetchMarkets(null)

    const calledUrl = (fetch as any).mock.calls[0][0]
    expect(calledUrl).toContain('/markets')
    expect(calledUrl).not.toContain('limit=')
  })

  it('appends all provided params to the URL', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ markets: [], cursor: 'next-cursor' }),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    await fetchMarkets(null, {
      limit: 10,
      status: 'open',
      category: 'Sports',
      search: 'nfl',
      cursor: 'abc123',
    })

    const calledUrl = (fetch as any).mock.calls[0][0]
    expect(calledUrl).toContain('limit=10')
    expect(calledUrl).toContain('status=open')
    expect(calledUrl).toContain('category=Sports')
    expect(calledUrl).toContain('search=nfl')
    expect(calledUrl).toContain('cursor=abc123')
  })

  it('sends RSA-PSS signed headers when auth provided', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ markets: [], cursor: null }),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    await fetchMarkets(TEST_AUTH)

    const calledHeaders = (fetch as any).mock.calls[0][1].headers
    expect(calledHeaders['KALSHI-ACCESS-KEY']).toBe('test-key-id')
    expect(calledHeaders['KALSHI-ACCESS-SIGNATURE']).toBe('mock-signature')
    expect(calledHeaders['KALSHI-ACCESS-TIMESTAMP']).toBeDefined()
  })

  it('returns markets array and cursor', async () => {
    const mockMarkets = [
      { ticker: 'TEST-1', title: 'Test Market', yes_ask: 55, yes_bid: 50 },
    ]
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ markets: mockMarkets, cursor: 'page-2' }),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    const result = await fetchMarkets(null)

    expect(result.markets).toEqual(mockMarkets)
    expect(result.cursor).toBe('page-2')
  })

  it('returns empty array and null cursor when response has no data', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    const result = await fetchMarkets(null)

    expect(result.markets).toEqual([])
    expect(result.cursor).toBeNull()
  })

  it('throws on non-OK response with status code in message', async () => {
    mockFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    await expect(fetchMarkets(null)).rejects.toThrow('401')
  })
})

describe('fetchMarket', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns data.market when present', async () => {
    const market = { ticker: 'SINGLE-1', title: 'Single market' }
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ market }),
    })
    const { fetchMarket } = await import('@/lib/kalshi')

    const result = await fetchMarket(null, 'SINGLE-1')
    expect(result).toEqual(market)
  })

  it('falls back to raw data when market field absent', async () => {
    const raw = { ticker: 'SINGLE-2', title: 'Raw market' }
    mockFetch({
      ok: true,
      json: () => Promise.resolve(raw),
    })
    const { fetchMarket } = await import('@/lib/kalshi')

    const result = await fetchMarket(null, 'SINGLE-2')
    expect(result).toEqual(raw)
  })

  it('throws on non-OK response', async () => {
    mockFetch({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    })
    const { fetchMarket } = await import('@/lib/kalshi')

    await expect(fetchMarket(null, 'MISSING')).rejects.toThrow('404')
  })
})

describe('getPortfolioBalance', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns portfolio data on success', async () => {
    const portfolio = { balance: 1000000, available_balance: 950000 }
    mockFetch({
      ok: true,
      json: () => Promise.resolve(portfolio),
    })
    const { getPortfolioBalance } = await import('@/lib/kalshi')

    const result = await getPortfolioBalance(TEST_AUTH)
    expect(result).toEqual(portfolio)
  })

  it('sends signed headers', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ balance: 0 }),
    })
    const { getPortfolioBalance } = await import('@/lib/kalshi')

    await getPortfolioBalance(TEST_AUTH)

    const calledHeaders = (fetch as any).mock.calls[0][1].headers
    expect(calledHeaders['KALSHI-ACCESS-KEY']).toBe('test-key-id')
  })

  it('throws on auth failure', async () => {
    mockFetch({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    })
    const { getPortfolioBalance } = await import('@/lib/kalshi')

    await expect(getPortfolioBalance(TEST_AUTH)).rejects.toThrow('403')
  })
})

describe('fetchWithRetry (network resilience)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('retries once on ECONNRESET and succeeds on the second attempt', async () => {
    const econnreset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(econnreset)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ markets: [], cursor: null }),
        text: () => Promise.resolve(''),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchMarkets } = await import('@/lib/kalshi')
    const result = await fetchMarkets(null)

    // Genuinely exercises the retry path — a self-recursion bug (retry
    // wrapper calling itself instead of the real fetch) would hang or
    // stack-overflow here rather than resolve.
    expect(result).toEqual({ markets: [], cursor: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on a normal HTTP error response (e.g. 401) — only connection failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchMarkets } = await import('@/lib/kalshi')

    await expect(fetchMarkets(null)).rejects.toThrow('401')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries on a persistent connection failure', async () => {
    const econnreset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const fetchMock = vi.fn().mockRejectedValue(econnreset)
    vi.stubGlobal('fetch', fetchMock)

    const { fetchMarkets } = await import('@/lib/kalshi')

    await expect(fetchMarkets(null)).rejects.toThrow(/ECONNRESET|failed after/)
    // Initial attempt + MAX_RETRIES (2) = 3 total calls, never more.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('V2 order translation (__toV2OrderBody) — REAL MONEY, direction-critical', () => {
  beforeEach(() => { vi.resetModules() })

  // The four side×action combinations must map to the correct YES-book side and
  // price. A single wrong bid/ask flips a buy into a sell; a wrong price
  // inversion trades at the wrong level. These are the tests that must never
  // silently break.

  it('buy YES @ 45¢ → bid on YES at $0.45', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'yes', action: 'buy', count: 3, price_cents: 45 })
    expect(body.side).toBe('bid')
    expect(body.price).toBe(0.45)
    expect(body.count).toBe(3)
    expect(body.ticker).toBe('T')
  })

  it('sell YES @ 45¢ → ask on YES at $0.45', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'yes', action: 'sell', count: 1, price_cents: 45 })
    expect(body.side).toBe('ask')
    expect(body.price).toBe(0.45)
  })

  it('buy NO @ 60¢ → ask on YES at $0.40 (buy NO ≡ sell YES at inverse price)', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'no', action: 'buy', count: 2, price_cents: 60 })
    expect(body.side).toBe('ask')
    expect(body.price).toBe(0.40) // 1 − 0.60, computed in cents to avoid float drift
  })

  it('sell NO @ 60¢ → bid on YES at $0.40 (sell NO ≡ buy YES at inverse price)', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'no', action: 'sell', count: 1, price_cents: 60 })
    expect(body.side).toBe('bid')
    expect(body.price).toBe(0.40)
  })

  it('defaults action to buy when omitted', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'yes', count: 1, price_cents: 30 })
    expect(body.side).toBe('bid')
  })

  it('maps expiration_ts → immediate_or_cancel, otherwise good_till_canceled', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const ioc = __toV2OrderBody({ ticker: 'T', side: 'yes', count: 1, price_cents: 50, expiration_ts: 123 })
    expect(ioc.time_in_force).toBe('immediate_or_cancel')
    const gtc = __toV2OrderBody({ ticker: 'T', side: 'yes', count: 1, price_cents: 50 })
    expect(gtc.time_in_force).toBe('good_till_canceled')
  })

  it('never emits the deprecated v1 fields (action/type/yes_price/no_price)', async () => {
    const { __toV2OrderBody } = await import('@/lib/kalshi')
    const body = __toV2OrderBody({ ticker: 'T', side: 'no', action: 'buy', count: 1, price_cents: 60 })
    expect(body).not.toHaveProperty('action')
    expect(body).not.toHaveProperty('type')
    expect(body).not.toHaveProperty('yes_price')
    expect(body).not.toHaveProperty('no_price')
    // client_order_id must be present (idempotency key)
    expect(typeof body.client_order_id).toBe('string')
    expect(body.client_order_id.length).toBeGreaterThan(0)
  })

  it('posts to the V2 /portfolio/events/orders endpoint, not the deprecated path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ order: { order_id: 'o1', status: 'resting' } }),
      text: () => Promise.resolve(''),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { placeOrder } = await import('@/lib/kalshi')
    await placeOrder(TEST_AUTH, { ticker: 'T', side: 'yes', action: 'buy', count: 1, price_cents: 50 })

    const calledUrl = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('/portfolio/events/orders')
    expect(calledUrl).not.toMatch(/\/portfolio\/orders(\?|$)/)
  })
})
