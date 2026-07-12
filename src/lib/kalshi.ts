import { createSign, createPrivateKey, constants, randomUUID } from 'crypto'

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'
const PATH_PREFIX = '/trade-api/v2'

// Plain fetch() had no timeout and no retry anywhere in this file. A single
// dropped connection (ECONNRESET, a Wi-Fi blip, a proxy hiccup) surfaced as a
// raw unformatted network error straight to the user — most visibly during
// the scanner's market-fetch pagination, which can be 25 sequential requests.
// Retries only cover connection-level failures (never HTTP error responses —
// those are legitimate API answers the caller already handles via !res.ok).
const FETCH_TIMEOUT_MS = 15000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500

function isRetryableNetworkError(err: any): boolean {
  const code = err?.cause?.code ?? err?.code
  const msg = String(err?.message ?? err?.cause?.message ?? '')
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'ENOTFOUND' ||
    err?.name === 'AbortError' ||
    /fetch failed/i.test(msg) ||
    /network/i.test(msg) ||
    /socket hang up/i.test(msg)
  )
}

async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let lastErr: any
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (err: any) {
      lastErr = err
      if (attempt >= MAX_RETRIES || !isRetryableNetworkError(err)) {
        throw new Error(
          `Kalshi request failed after ${attempt + 1} attempt(s): ${err?.message || err}`
        )
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  // Unreachable — the loop above always returns or throws — but keeps TS happy.
  throw lastErr
}

// Kalshi uses RSA-PSS signed requests for all authenticated endpoints.
// Docs: https://trading-api.kalshi.com/docs
export interface KalshiAuth {
  keyId: string      // API Key ID (UUID from Kalshi dashboard)
  privateKey: string // RSA private key PEM
}

function normalizePem(raw: string): string {
  // 1. Replace literal two-char \n sequences (from JSON stringification artifacts)
  let s = raw.replace(/\\n/g, '\n')
  // 2. Normalise Windows CRLF and bare CR to LF
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 3. Trim surrounding whitespace
  s = s.trim()

  // 4. If there are no PEM headers, the key was saved as raw base64 DER.
  //    Detect by checking for the -----BEGIN marker.
  if (!s.includes('-----BEGIN')) {
    // Strip all whitespace to get pure base64, then wrap with PKCS#1 headers.
    // MIIEpA... prefix indicates PKCS#1 RSA private key; MIIE4Q/MIIEvA = also PKCS#1.
    // Anything without headers is treated as PKCS#1 (most common from Kalshi).
    const b64 = s.replace(/\s+/g, '')
    const lines = b64.match(/.{1,64}/g) ?? []
    return `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----`
  }

  // 5. Reconstruct PEM with standard 64-char line wrapping so OpenSSL can parse it
  //    regardless of how the base64 body was originally line-wrapped.
  const headerMatch = s.match(/-----BEGIN ([^-]+)-----/)
  const footerMatch = s.match(/-----END ([^-]+)-----/)
  if (headerMatch && footerMatch) {
    const header = headerMatch[0]
    const footer = footerMatch[0]
    const body = s
      .slice(s.indexOf(header) + header.length, s.lastIndexOf(footer))
      .replace(/\s+/g, '')
    const lines = body.match(/.{1,64}/g) ?? []
    s = `${header}\n${lines.join('\n')}\n${footer}`
  }

  return s
}

function getSignedHeaders(auth: KalshiAuth, method: string, urlPath: string): Record<string, string> {
  const timestampMs = Date.now()
  const msgToSign = `${timestampMs}${method.toUpperCase()}${urlPath}`

  const pemNormalized = normalizePem(auth.privateKey)
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
  // Kalshi is inconsistent about accepted values ('open' vs 'active'), so
  // callers may need to probe — keep this a plain string.
  status?: string
  category?: string
  search?: string
  // Only markets whose close_time is at/after this Unix timestamp (seconds).
  // The reliable way to exclude settled/expired markets regardless of the
  // status param's mood.
  min_close_ts?: number
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
    if (params.min_close_ts) url.searchParams.set('min_close_ts', String(params.min_close_ts))
  }

  const headers: Record<string, string> =
    auth?.keyId && auth?.privateKey
      ? getSignedHeaders(auth, 'GET', `${PATH_PREFIX}/markets`)
      : { 'Content-Type': 'application/json' }

  const res = await fetchWithRetry(url.toString(), { headers })

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
  // Encode the ticker in both the signed path and the fetch URL — they must
  // stay identical for the request signature to validate.
  const encodedTicker = encodeURIComponent(ticker)
  const path = `${PATH_PREFIX}/markets/${encodedTicker}`
  const headers: Record<string, string> =
    auth?.keyId && auth?.privateKey
      ? getSignedHeaders(auth, 'GET', path)
      : { 'Content-Type': 'application/json' }

  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/markets/${encodedTicker}`, { headers })

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
  action?: 'buy' | 'sell' // default 'buy'; 'sell' closes a held position on the same side
  client_order_id?: string
  // Unix seconds after which Kalshi cancels the order server-side if unfilled.
  // Autopilot prices orders at the current ask expecting an immediate fill —
  // without this, a marketable order that doesn't fill (price moved, thin
  // book) rests indefinitely, silently tying up spend/exposure headroom that
  // the next cycle still counts as spent.
  expiration_ts?: number
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

// Translate this app's (side: yes|no, action: buy|sell, price in cents) model to
// a Kalshi V2 order and POST it. The old /portfolio/orders create endpoint was
// deprecated (HTTP 410 deprecated_v1_order_endpoint); V2 lives at
// /portfolio/events/orders and speaks a different language:
//   - The orderbook is expressed on the YES leg only. side "bid" = buy YES,
//     side "ask" = sell YES.
//   - Buying/selling NO is the economic inverse of selling/buying YES at the
//     complementary price: buy NO @ q  ≡  sell YES @ (1−q). Kalshi documents
//     that "there is no inherent difference between buying YES and selling NO."
//   - price is a single field in DOLLARS (0.65), not yes_price/no_price in cents.
//   - client_order_id must be a UUID (also the idempotency key — a repeated id
//     returns the original order rather than double-filling).
//   - time_in_force replaces expiration_ts. Callers that passed expiration_ts
//     wanted "fill now, don't linger" → immediate_or_cancel; others rest as
//     good_till_canceled.
function toV2OrderBody(req: PlaceOrderRequest): Record<string, any> {
  const isBuy = (req.action ?? 'buy') === 'buy'

  // Everything is quoted on the YES book. Compute the equivalent YES price in
  // integer cents first (exact), then convert to dollars — avoids float drift
  // like 1 − 0.6 ≠ 0.4.
  const yesPriceCents = req.side === 'yes' ? req.price_cents : 100 - req.price_cents

  // bid when (buy YES) or (sell NO); ask when (sell YES) or (buy NO).
  const bookSide: 'bid' | 'ask' = (req.side === 'yes') === isBuy ? 'bid' : 'ask'

  const body: Record<string, any> = {
    ticker: req.ticker,
    client_order_id: req.client_order_id ?? randomUUID(),
    side: bookSide,
    // Confirmed by a live 400: the Go backend unmarshals these into a Decimal
    // struct field typed as string, not a JSON number ("cannot unmarshal
    // number into Go struct field CreateOrderV2Request.count of type string").
    // price gets the same treatment on the same struct — send both as strings.
    count: String(req.count),
    price: (yesPriceCents / 100).toFixed(2), // dollars, penny-granular, as string
    time_in_force: req.expiration_ts ? 'immediate_or_cancel' : 'good_till_canceled',
    // Confirmed required by a live 400 (Go 'required' validation tag). Two
    // options exist: "taker_at_cross" cancels OUR incoming order if it would
    // cross our own resting order; "maker" cancels the resting one instead.
    // taker_at_cross is the documented default and the safer choice for an
    // automated system — it never touches an order already resting/working.
    self_trade_prevention_type: 'taker_at_cross',
  }
  return body
}

export async function placeOrder(
  auth: KalshiAuth,
  req: PlaceOrderRequest
): Promise<PlaceOrderResult> {
  const urlPath = `${PATH_PREFIX}/portfolio/events/orders`
  const body = toV2OrderBody(req)

  const headers = getSignedHeaders(auth, 'POST', urlPath)

  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/events/orders`, {
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
    order_id: o.order_id ?? o.id ?? o.client_order_id,
    status: o.status,
    ticker: o.ticker ?? req.ticker,
    side: o.side ?? req.side,
    count: Number(o.count ?? req.count),
    yes_price: o.yes_price ?? o.price,
    created_time: o.created_time ?? o.created_ts ?? new Date().toISOString(),
  }
}

// Exported for unit testing the V1→V2 order translation (the bid/ask + inverse-
// price mapping is real-money-critical and must be locked down by tests).
export const __toV2OrderBody = toV2OrderBody

// Resting (unfilled/partially-filled) orders — used to reconcile stale orders
// left over from a prior cycle before placing new ones.
export async function getOpenOrders(auth: KalshiAuth): Promise<any[]> {
  const urlPath = `${PATH_PREFIX}/portfolio/orders`
  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/orders?status=resting`, {
    headers: getSignedHeaders(auth, 'GET', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data.orders || []
}

export async function cancelOrder(auth: KalshiAuth, orderId: string): Promise<void> {
  const urlPath = `${PATH_PREFIX}/portfolio/orders/${orderId}`
  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/orders/${orderId}`, {
    method: 'DELETE',
    headers: getSignedHeaders(auth, 'DELETE', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi order cancel error ${res.status}: ${text}`)
  }
}

export async function getPortfolioBalance(auth: KalshiAuth): Promise<any> {
  const urlPath = `${PATH_PREFIX}/portfolio/balance`
  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/balance`, {
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
  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/positions`, {
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
  const res = await fetchWithRetry(`${KALSHI_BASE_URL}/portfolio/settlements?limit=${limit}`, {
    headers: getSignedHeaders(auth, 'GET', urlPath),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API error ${res.status}: ${text}`)
  }
  return res.json()
}
