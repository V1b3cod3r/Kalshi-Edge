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

export interface PlaceOrderRequest {
  ticker: string
  side: 'yes' | 'no'
  count: number       // number of contracts (integer)
  price_cents: number // limit price in cents (1–99)
  client_order_id?: string
}

export interface PlaceOrderResult {
  order_id: string
  status: string
  ticker: string
  side: string
  count: number
  yes_price: number   // cents
  created_time: string
}

export async function placeOrder(
  apiKey: string,
  req: PlaceOrderRequest
): Promise<PlaceOrderResult> {
  const body: Record<string, any> = {
    action: 'buy',
    type: 'limit',
    ticker: req.ticker,
    side: req.side,
    count: req.count,
    client_order_id: req.client_order_id ?? `ke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }

  if (req.side === 'yes') {
    body.yes_price = req.price_cents
  } else {
    body.no_price = req.price_cents
  }

  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi order error ${res.status}: ${text}`)
  }

  const data = await res.json()
  const o = data.order || data
  return {
    order_id: o.order_id,
    status: o.status,
    ticker: o.ticker,
    side: o.side,
    count: o.count,
    yes_price: o.yes_price,
    created_time: o.created_time,
  }
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
