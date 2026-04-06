const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

interface FetchMarketsParams {
  limit?: number
  cursor?: string
  event_ticker?: string
  series_ticker?: string
  status?: 'open' | 'closed' | 'settled'
  category?: string
  search?: string
}

export async function fetchMarkets(
  apiKey: string,
  params?: FetchMarketsParams
): Promise<{ markets: any[]; cursor: string | null }> {
  const url = new URL(`${KALSHI_BASE_URL}/markets`)

  if (params) {
    if (params.limit) url.searchParams.set('limit', String(params.limit))
    if (params.cursor) url.searchParams.set('cursor', params.cursor)
    if (params.event_ticker) url.searchParams.set('event_ticker', params.event_ticker)
    if (params.series_ticker) url.searchParams.set('series_ticker', params.series_ticker)
    if (params.status) url.searchParams.set('status', params.status)
    if (params.category) url.searchParams.set('category', params.category)
    if (params.search) url.searchParams.set('search', params.search)
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return {
    markets: data.markets || [],
    cursor: data.cursor || null,
  }
}

export async function fetchMarket(apiKey: string, ticker: string): Promise<any> {
  const res = await fetch(`${KALSHI_BASE_URL}/markets/${ticker}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return data.market || data
}

export async function getPortfolio(apiKey: string): Promise<any> {
  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/balance`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }

  return res.json()
}
