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
