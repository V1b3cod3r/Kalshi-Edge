import { describe, it, expect, vi, beforeEach } from 'vitest'

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve('')),
  }))
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

    await fetchMarkets('test-api-key')

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

    await fetchMarkets('test-api-key', {
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

  it('sends Authorization header with Bearer token', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ markets: [], cursor: null }),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    await fetchMarkets('my-secret-key')

    const calledHeaders = (fetch as any).mock.calls[0][1].headers
    expect(calledHeaders.Authorization).toBe('Bearer my-secret-key')
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

    const result = await fetchMarkets('key')

    expect(result.markets).toEqual(mockMarkets)
    expect(result.cursor).toBe('page-2')
  })

  it('returns empty array and null cursor when response has no data', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const { fetchMarkets } = await import('@/lib/kalshi')

    const result = await fetchMarkets('key')

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

    await expect(fetchMarkets('bad-key')).rejects.toThrow('401')
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

    const result = await fetchMarket('key', 'SINGLE-1')
    expect(result).toEqual(market)
  })

  it('falls back to raw data when market field absent', async () => {
    const raw = { ticker: 'SINGLE-2', title: 'Raw market' }
    mockFetch({
      ok: true,
      json: () => Promise.resolve(raw),
    })
    const { fetchMarket } = await import('@/lib/kalshi')

    const result = await fetchMarket('key', 'SINGLE-2')
    expect(result).toEqual(raw)
  })

  it('throws on non-OK response', async () => {
    mockFetch({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    })
    const { fetchMarket } = await import('@/lib/kalshi')

    await expect(fetchMarket('key', 'MISSING')).rejects.toThrow('404')
  })
})

describe('getPortfolio', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns portfolio data on success', async () => {
    const portfolio = { balance: 10000, available_balance: 9500 }
    mockFetch({
      ok: true,
      json: () => Promise.resolve(portfolio),
    })
    const { getPortfolio } = await import('@/lib/kalshi')

    const result = await getPortfolio('key')
    expect(result).toEqual(portfolio)
  })

  it('throws on auth failure', async () => {
    mockFetch({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    })
    const { getPortfolio } = await import('@/lib/kalshi')

    await expect(getPortfolio('bad-key')).rejects.toThrow('403')
  })
})
