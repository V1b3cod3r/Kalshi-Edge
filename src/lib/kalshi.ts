import { createSign, createPrivateKey, constants } from 'crypto'

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'
const PATH_PREFIX = '/trade-api/v2'

// Kalshi uses RSA-PSS signed requests for all authenticated endpoints.
// Docs: https://trading-api.kalshi.com/docs
export interface KalshiAuth {
  keyId: string      // API Key ID (UUID from Kalshi dashboard)
  privateKey: string // RSA private key PEM
}

function getSignedHeaders(auth: KalshiAuth, method: string, urlPath: string): Record<string, string> {
  const timestampMs = Date.now()
  const msgToSign = `${timestampMs}${method.toUpperCase()}${urlPath}`

  // Normalise the key: replace literal \n sequences with real newlines
  // (can happen when the PEM is stored in JSON with escaped newlines)
  // Also handles both PKCS#1 (-----BEGIN RSA PRIVATE KEY-----) and PKCS#8
  const pemNormalized = auth.privateKey.replace(/\\n/g, '\n')
  const privateKey = createPrivateKey(pemNormalized)

  const signer = createSign('SHA256')
  signer.update(msgToSign)
  signer.end()

  const signature = signer.sign(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    },
    'base64'
  )

  return {
    'KALSHI-ACCESS-KEY': auth.keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    'Content-Type': 'application/json',
  }
}

interface FetchMarketsParams {
  limit?: number
  cursor?: string
  event_ticker?: string
  series_ticker?: string
  status?: 'open' | 'closed' | 'settled'
  category?: string
  search?: string
}

// Market read endpoints are public — no auth required.
// Pass auth to get higher rate limits if desired (optional).
export async function fetchMarkets(
  auth: KalshiAuth | null,
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

  const headers: Record<string, string> =
    auth?.keyId && auth?.privateKey
      ? getSignedHeaders(auth, 'GET', `${PATH_PREFIX}/markets`)
      : { 'Content-Type': 'application/json' }

  const res = await fetch(url.toString(), { headers })

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

export async function fetchMarket(auth: KalshiAuth | null, ticker: string): Promise<any> {
  const path = `${PATH_PREFIX}/markets/${ticker}`
  const headers: Record<string, string> =
    auth?.keyId && auth?.privateKey
      ? getSignedHeaders(auth, 'GET', path)
      : { 'Content-Type': 'application/json' }

  const res = await fetch(`${KALSHI_BASE_URL}/markets/${ticker}`, { headers })

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
  yes_price: number
  created_time: string
}

export async function placeOrder(
  auth: KalshiAuth,
  req: PlaceOrderRequest
): Promise<PlaceOrderResult> {
  const urlPath = `${PATH_PREFIX}/portfolio/orders`
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

  const headers = getSignedHeaders(auth, 'POST', urlPath)

  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/orders`, {
    method: 'POST',
    headers,
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

export async function getPortfolioBalance(auth: KalshiAuth): Promise<any> {
  const urlPath = `${PATH_PREFIX}/portfolio/balance`
  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/balance`, {
    headers: getSignedHeaders(auth, 'GET', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getPortfolioPositions(auth: KalshiAuth): Promise<any> {
  const urlPath = `${PATH_PREFIX}/portfolio/positions`
  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/positions`, {
    headers: getSignedHeaders(auth, 'GET', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function getPortfolioSettlements(auth: KalshiAuth, limit = 50): Promise<any> {
  const urlPath = `${PATH_PREFIX}/portfolio/settlements`
  const res = await fetch(`${KALSHI_BASE_URL}/portfolio/settlements?limit=${limit}`, {
    headers: getSignedHeaders(auth, 'GET', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }
  return res.json()
}
