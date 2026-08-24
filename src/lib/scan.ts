import fs from 'fs'
import path from 'path'
import { getViews, getSession, getSettings, getCalibrationStats, createPrediction, getRelevantLessons, getPredictions } from '@/lib/storage'
import { buildScannerSystemPrompt, buildScannerUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { fetchMarkets } from '@/lib/kalshi'
import { MarketInput, Lesson } from '@/lib/types'
import { getSignalsForMarkets } from '@/lib/signals'
import { getWebContextForMarkets } from '@/lib/search'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared market-scan pipeline used by /api/auto-scan, /api/auto-scan/stream,
// and the autopilot engine. Single source of truth for pagination, market
// normalization, filtering, the Claude call, Zod parsing, and effective-edge
// post-processing.
// ---------------------------------------------------------------------------

// Typed error so API routes can map failures to the exact status codes and
// messages they returned before this logic was extracted.
export class ScanError extends Error {
  code: 'config' | 'no_markets' | 'parse'
  constructor(code: 'config' | 'no_markets' | 'parse', message: string) {
    super(message)
    this.code = code
    this.name = 'ScanError'
  }
}

// Maps a market to our 4 standard categories. Kalshi market objects often
// ship WITHOUT a category field (category lives on the parent event), so
// relying on it alone buckets everything as Other/General — and then any
// category filter empties the entire scan. Fall back to ticker+title keywords.
export function mapCategory(kalshiCategory: string | undefined, ticker?: string, title?: string): string {
  const c = (kalshiCategory ?? '').toLowerCase()
  const t = ` ${ticker ?? ''} ${title ?? ''} `.toLowerCase()
  if (
    /(polit|elect|gov|president)/.test(c) ||
    /(trump|biden|harris|congress|senate|election|president|governor|shutdown|tariff|impeach|supreme court|white house)/.test(t)
  ) {
    return 'Politics & Elections'
  }
  if (
    /(econ|financ|fed|market|crypto|stock|rate|gdp|inflation|cpi)/.test(c) ||
    /(fomc|fed |cpi|inflation|gdp|jobless|unemployment|payroll|mortgage|s&p|nasdaq|dow jones|bitcoin|btc|ethereum|solana|crypto|treasury|recession|interest rate|price of)/.test(t)
  ) {
    return 'Economics/Finance'
  }
  if (
    /(sport|nfl|nba|mlb|nhl|soccer|tennis|golf)/.test(c) ||
    /(nfl|nba|mlb|nhl|ncaa|ufc|premier league|world cup|super bowl|stanley cup|world series|grand slam|f1 |nascar)/.test(t)
  ) {
    return 'Sports'
  }
  return 'Other/General'
}

// Parse a Kalshi price field into decimal dollars. Prefer the *_dollars
// field; the plain field is integer cents in Kalshi v2 (so a raw `1` means
// 1¢, not $1). Sub-1 values in the plain field are already dollars (legacy
// payloads). Shared across every place that parses a live Kalshi quote
// (market normalization here, and portfolio P&L's live-price lookups) so a
// field-shape fix only ever needs to happen in one place.
export function parseKalshiPrice(dollarsV: any, centsV: any): number {
  if (dollarsV != null && Number(dollarsV) > 0) return Number(dollarsV)
  const c = centsV == null ? 0 : Number(centsV)
  if (!c || c <= 0) return 0
  return c >= 1 ? c / 100 : c
}

// Normalize a Kalshi market object (whose shape can vary) into our MarketInput
export function normalizeMarket(m: any): MarketInput | null {
  // Skip MVE parlay bundles — user-created multi-leg combos with no real liquidity
  if (m.mve_selected_legs || (m.ticker && String(m.ticker).includes('KXMVE'))) return null

  // Title: try multiple field names
  const title = m.title || m.question || m.subtitle || m.event_title
  if (!title) return null

  // Use ask prices for order placement — bidding at ask fills immediately.
  // Midpoint would leave orders resting below the ask.
  const ya = parseKalshiPrice(m.yes_ask_dollars, m.yes_ask)
  const yb = parseKalshiPrice(m.yes_bid_dollars, m.yes_bid)
  const na = parseKalshiPrice(m.no_ask_dollars, m.no_ask)
  const nb = parseKalshiPrice(m.no_bid_dollars, m.no_bid)

  // YES ask (cost to buy YES): 1 − no_bid IS the yes ask. Never derive from
  // 1 − no_ask — that's the yes BID, which understates cost by the full spread
  // and manufactures phantom edge on thin markets.
  const yes_price = ya > 0 ? ya : nb > 0 ? parseFloat((1 - nb).toFixed(4)) : undefined
  // NO ask (cost to buy NO), mirrored: derive only from 1 − yes_bid.
  const no_price = na > 0 ? na : yb > 0 ? parseFloat((1 - yb).toFixed(4)) : undefined

  // Both sides must be quotable from a live orderbook. Markets with only a
  // stale last_price have no real market to execute against — skip them
  // (a "cheap-looking" stale print is staleness, not edge).
  if (!yes_price || !no_price) return null

  // Volume: compute dollar volume as contracts × midpoint price. Field names
  // vary across Kalshi payload variants — prefer the 24h contract count, fall
  // back to lifetime volume rather than defaulting everything to zero (a zero
  // default makes any volume filter silently wipe the whole scan).
  const contracts =
    Number(m.volume_24h ?? m.volume_24h_fp) ||
    Number(m.volume ?? m.volume_fp) ||
    0
  const mid = (yes_price + (1 - no_price)) / 2
  const volume_24h = contracts * mid

  // Resolution date
  const resolution_date = m.close_time || m.expiration_time || m.expected_expiration_ts || undefined

  // Resolution criteria
  const resolution_criteria =
    m.rules_primary || m.settlement_source_description || m.subtitle || undefined

  // Category
  const category = mapCategory(m.category || m.event_category, m.ticker, String(title))

  // Ticker as ID
  const id = m.ticker || m.id || undefined

  return {
    id,
    title: String(title),
    yes_price,
    no_price,
    // Raw quote sides for midpoint-based calibration scoring. yes_price above
    // is the ASK; scoring the market at the ask hands Claude half the spread.
    // Derive the bid the same defensive way the ask is derived.
    yes_ask: yes_price,
    yes_bid: yb > 0 ? yb : na > 0 ? parseFloat((1 - na).toFixed(4)) : undefined,
    // Markets sharing an event are near-perfectly correlated — preferred over
    // ticker-prefix heuristics for cluster caps. May be absent; consumers fall back.
    event_ticker: m.event_ticker ? String(m.event_ticker) : undefined,
    volume_24h: Number(volume_24h) || 0,
    resolution_date: resolution_date ? String(resolution_date) : undefined,
    resolution_criteria: resolution_criteria ? String(resolution_criteria) : undefined,
    category,
  }
}

const OpportunitySchema = z.object({
  ticker: z.string(),
  title: z.string(),
  direction: z.enum(['YES', 'NO']),
  my_estimate_pct: z.number().min(0).max(100),
  market_price_pct: z.number().min(0).max(100),
  edge_pct: z.number(),
  score: z.number(),
  rationale: z.string(),
  key_risk: z.string().optional().default(''),
  flags: z.array(z.string()),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
})

const ScreenedOutSchema = z.object({
  ticker: z.string(),
  title: z.string(),
  reason: z.string(),
})

// Structured outputs (json_schema) guarantee every field's TYPE is correct,
// but numeric range constraints (min/max) are NOT supported by the API's
// schema format — a percentage arriving as 100.4 or -1 due to rounding would
// otherwise pass the API's own validation and then hard-fail ours. Clamp
// obviously-in-spirit values instead of discarding a whole scan over it;
// genuinely malformed data (wrong type, missing field) still fails below.
function repairScanJson(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return parsed
  const clampPct = (v: any) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : v
  if (Array.isArray(parsed.opportunities)) {
    parsed.opportunities = parsed.opportunities.map((o: any) => ({
      ...o,
      my_estimate_pct: clampPct(o?.my_estimate_pct),
      market_price_pct: clampPct(o?.market_price_pct),
      flags: Array.isArray(o?.flags) ? o.flags : [],
    }))
  }
  return parsed
}

const ScanResultSchema = z.object({
  opportunities: z.array(OpportunitySchema),
  screened_out: z.array(ScreenedOutSchema).default([]),
  session_notes: z.string().optional().default(''),
})

// JSON Schema mirror of ScanResultSchema for the API's structured outputs —
// the server constrains generation to this shape, so the response is always
// pure parseable JSON (no prose preamble, no markdown fences), on any model.
// Note: numeric min/max constraints are unsupported by structured outputs;
// the Zod parse afterward still enforces them.
const SCAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['opportunities', 'screened_out', 'session_notes'],
  properties: {
    opportunities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ticker', 'title', 'direction', 'my_estimate_pct', 'market_price_pct',
          'edge_pct', 'score', 'rationale', 'key_risk', 'flags', 'confidence',
        ],
        properties: {
          ticker: { type: 'string' },
          title: { type: 'string' },
          direction: { type: 'string', enum: ['YES', 'NO'] },
          my_estimate_pct: { type: 'number' },
          market_price_pct: { type: 'number' },
          edge_pct: { type: 'number' },
          score: { type: 'number' },
          rationale: { type: 'string' },
          key_risk: { type: 'string' },
          flags: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        },
      },
    },
    screened_out: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ticker', 'title', 'reason'],
        properties: {
          ticker: { type: 'string' },
          title: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    session_notes: { type: 'string' },
  },
}

// Shrinkage: 60% market / 40% Claude (conservative until calibration proves otherwise)
export const SHRINK_MARKET = 0.60
export const SHRINK_CLAUDE = 0.40
// Kalshi taker fee coefficient: fee = 0.07 × P × (1−P) per contract. This is
// the TAKER rate — every order this app places crosses the spread (IOC), so
// it is the correct default. Kalshi halves it on S&P/Nasdaq range markets.
export const KALSHI_FEE_COEF = 0.07
// S&P 500 (INX*) and Nasdaq-100 (NASDAQ100*) series get a halved taker fee
// coefficient per Kalshi's published fee schedule. Applying the standard
// 0.07 to these series overcharges the edge calc 2x and needlessly screens
// out otherwise-tradeable opportunities on exactly the series most amenable
// to a mechanical (options-implied-vol) pricing model.
export function kalshiFeeCoef(ticker: string | undefined | null): number {
  const t = String(ticker ?? '').toUpperCase()
  if (t.startsWith('INX') || t.startsWith('NASDAQ100')) return 0.035
  return KALSHI_FEE_COEF
}
// Default minimum effective edge after fees and shrinkage, in fraction terms
// (0.12 = 12pp). Set at the calibration floor, not a hopeful guess: KalshiBench
// (300 real Kalshi questions, 5 frontier models) measured Claude Opus 4.5 —
// the best of the five — at ECE 0.120 on genuinely-unknown future events.
// A "3pp divergence from market" threshold is smaller than the model's own
// measured calibration error, which means it is mostly sampling that error,
// not detecting real mispricing. This floor doesn't guarantee edge is real
// above it, but below it the "edge" is indistinguishable from calibration
// noise by construction. Re-tune from YOUR OWN measured ECE once you have
// enough resolved predictions (getCalibrationStats) — do not lower this
// without first measuring your own reliability curve.
export const MIN_EFFECTIVE_EDGE = 0.12

export interface ScanProgressEvent {
  phase: 'fetching' | 'filtering' | 'analyzing'
  message: string
  count: number
}

export interface ScanOpportunity {
  ticker: string
  title: string
  direction: 'YES' | 'NO'
  my_estimate_pct: number
  market_price_pct: number
  edge_pct: number           // effective edge (shrunk, fee-adjusted), percent
  score: number
  rationale: string
  key_risk: string
  flags: string[]
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  yes_price: number | null
  no_price: number | null
  volume_24h: number | null
  resolution_date: string | null
  // Extra fields for programmatic consumers (autopilot). Additive — UI ignores.
  category: string
  p_shrunk: number           // shrunk P(YES), 0–1
  execution_price: number | null // ask price for the chosen side, 0–1; null if market lookup failed
  days_to_resolution: number | null   // null when resolution_date is missing/unparseable
  annualized_edge_pct: number | null  // edge_pct scaled to a 365-day capital-velocity basis; null when days_to_resolution is null
}

export interface RunScanParams {
  category?: string
  limit?: number
  min_volume?: number
  // Minimum effective edge (fraction, e.g. 0.07 = 7pp). Defaults to MIN_EFFECTIVE_EDGE.
  min_effective_edge?: number
  // Exclude markets resolving further out than this many days. Long-dated
  // markets tie up capital for years to earn a few points of edge and never
  // resolve fast enough to feed the calibration loop. Undefined = no cap
  // (back-compat for callers that want the full universe, e.g. manual scanner).
  max_days_to_resolution?: number
  // Log opportunities to the calibration prediction store (default true, source 'scanner').
  logPredictions?: boolean
  onProgress?: (event: ScanProgressEvent) => void
}

export interface RunScanResult {
  opportunities: ScanOpportunity[]
  // direction/edge_pct are set on code-generated entries (near-the-threshold
  // effective-edge misses, which know Claude's recommended side and the
  // computed edge) and absent on Claude's own screened_out entries (fairly-
  // priced markets have no recommended side or computed edge).
  screened_out: { ticker: string; title: string; reason: string; direction?: 'YES' | 'NO'; edge_pct?: number }[]
  session_notes: string
  markets_scanned: number
}

export async function runScan(params: RunScanParams = {}): Promise<RunScanResult> {
  const {
    category,
    limit = 15,
    min_volume = 0,
    min_effective_edge = MIN_EFFECTIVE_EDGE,
    max_days_to_resolution,
    logPredictions = true,
    onProgress,
  } = params

  const progress = (event: ScanProgressEvent) => {
    try {
      onProgress?.(event)
    } catch {
      // progress reporting is never allowed to break the scan
    }
  }

  const settings = getSettings()

  if (!settings.kalshi_api_key) {
    throw new ScanError('config', 'Kalshi API key not configured. Please add it in Settings.')
  }
  if (!settings.anthropic_api_key) {
    throw new ScanError('config', 'Anthropic API key not configured. Please add it in Settings.')
  }

  // Step 1: Paginate through ALL open markets on Kalshi.
  // status=open filters at the API level so closed/settled markets never enter
  // the pool. Paginating the generic endpoint covers every series — a curated
  // list goes stale as Kalshi adds new markets.
  progress({ phase: 'fetching', message: 'Fetching open markets from Kalshi...', count: 0 })

  const rawMarkets: any[] = []
  const seenTickers = new Set<string>()
  let cursor: string | null = null
  let lastFetchError: string | null = null
  const MAX_PAGES = 25 // ~5000 markets max; Kalshi usually has <1000 open at once
  // min_close_ts excludes settled/expired markets by time, independent of the
  // status param — the reliable backstop when status filtering misbehaves.
  const minCloseTs = Math.floor(Date.now() / 1000)
  // When a resolution horizon is set (autopilot), constrain the FETCH itself,
  // not just the post-filter: Kalshi has far more open markets than the
  // MAX_PAGES pagination cap can hold, and without max_close_ts the pool can
  // fill entirely with far-dated markets — a live incident saw autopilot's
  // 45-day cap face a 3000-market pool containing zero near-dated markets,
  // and (with the then fail-open behavior) buy contracts resolving in
  // 2029-2035. Belt (this) and suspenders (the post-filter below).
  const maxCloseTs = max_days_to_resolution
    ? minCloseTs + Math.ceil(max_days_to_resolution * 86400)
    : undefined

  // Kalshi's GetMarkets status filter is inconsistent: some deployments accept
  // 'open', others 'active', and a wrong value returns an empty 200 rather
  // than an error. Probe candidates on the first page and lock in whichever
  // one actually returns markets; unfiltered is the last resort (runtime
  // filters below still exclude closed/expired markets).
  let statusParam: string | undefined
  let firstPage: { markets: any[]; cursor: string | null } | null = null
  for (const candidate of ['open', 'active', undefined]) {
    const res = await fetchMarkets(null, {
      ...(candidate ? { status: candidate } : {}),
      min_close_ts: minCloseTs,
      ...(maxCloseTs ? { max_close_ts: maxCloseTs } : {}),
      limit: 200,
    }).catch((err) => {
      // Record the failure instead of swallowing it — an all-candidates
      // failure must be reported as a fetch problem, not "no markets matched".
      lastFetchError = err?.message || String(err)
      return null
    })
    if (res && res.markets.length > 0) {
      statusParam = candidate
      firstPage = res
      break
    }
  }

  if (firstPage) {
    let result = firstPage
    for (let page = 0; page < MAX_PAGES; page++) {
      for (const m of result.markets) {
        const key = m.ticker || m.id
        if (!key || seenTickers.has(key)) continue
        // Skip MVE parlay bundles — user-created multi-leg combos with no liquidity
        if (m.mve_selected_legs || String(m.ticker ?? '').includes('KXMVE')) continue
        seenTickers.add(key)
        rawMarkets.push(m)
      }

      cursor = result.cursor

      // Progress update after each page (if we got markets)
      if (rawMarkets.length > 0) {
        progress({
          phase: 'fetching',
          message: `Fetched ${rawMarkets.length} markets (page ${page + 1})...`,
          count: rawMarkets.length,
        })
      }

      if (!cursor) break
      const next = await fetchMarkets(null, {
        ...(statusParam ? { status: statusParam } : {}),
        min_close_ts: minCloseTs,
        ...(maxCloseTs ? { max_close_ts: maxCloseTs } : {}),
        limit: 200,
        cursor,
      }).catch((err) => {
        lastFetchError = err?.message || String(err)
        return { markets: [] as any[], cursor: null as string | null }
      })
      result = next
    }
  }

  // Step 2: Normalize and filter
  progress({
    phase: 'filtering',
    message: `Filtering to top ${limit} candidates...`,
    count: rawMarkets.length,
  })

  if (rawMarkets.length === 0) {
    throw new ScanError(
      'no_markets',
      lastFetchError
        ? `Kalshi returned no markets — the fetch itself failed: ${lastFetchError}`
        : 'Kalshi returned zero markets for every status filter (open/active/unfiltered), all with close times in the future. The API is likely degraded — try again in a few minutes.'
    )
  }

  // Track the funnel stage-by-stage so an empty result names its culprit
  // instead of a generic "no markets found".
  const now = Date.now()
  const quoted: MarketInput[] = rawMarkets
    .map(normalizeMarket)
    .filter((m): m is MarketInput => m !== null)

  const unexpired = quoted.filter((m) => {
    if (!m.resolution_date) return true
    const ts = Date.parse(m.resolution_date)
    return !Number.isFinite(ts) || ts > now
  })

  // Cap the resolution horizon BEFORE sorting by volume — otherwise the most
  // liquid markets on all of Kalshi (typically multi-year politics/macro
  // questions) crowd out short-dated ones, which is exactly backwards: those
  // long-dated markets tie up capital for years per point of edge and their
  // predictions never resolve fast enough to validate the model. Undated or
  // unparseable-date markets are EXCLUDED, not passed through — an earlier
  // version let them through uncapped on the theory that "you can't judge a
  // horizon that isn't there", but that's exactly how live autopilot ended up
  // buying contracts resolving in 2029-2035 (see the FAIL CLOSED note below):
  // a market missing a resolution_date is no more provably short-dated than
  // one that openly reports a multi-year date, so it gets the same treatment.
  const withinHorizonCapped = max_days_to_resolution
    ? unexpired.filter((m) => {
        if (!m.resolution_date) return false
        const ts = Date.parse(m.resolution_date)
        if (!Number.isFinite(ts)) return false
        const days = (ts - now) / (1000 * 60 * 60 * 24)
        return days <= max_days_to_resolution
      })
    : unexpired

  // FAIL CLOSED, not open. An earlier version fell back to the uncapped pool
  // when this filter zeroed out a non-empty pool — and live autopilot then
  // BOUGHT contracts resolving in 2029-2035, exactly what the horizon cap
  // exists to prevent. Trading nothing is strictly better than trading
  // decade-out markets with real money. The pagination-bias root cause is
  // now also addressed at the source (max_close_ts constrains the fetch
  // itself), so a zero here means there genuinely are no near-dated markets
  // in the pool — stop and say so; never widen the universe on our own.
  const withinHorizon = withinHorizonCapped
  if (max_days_to_resolution && withinHorizonCapped.length === 0 && unexpired.length > 0) {
    throw new ScanError(
      'no_markets',
      `All ${unexpired.length} fetched markets resolve beyond the ${max_days_to_resolution}-day ` +
      `horizon. No trade is placed on long-dated markets by design (capital lockup). If this ` +
      `persists across cycles, either Kalshi's max_close_ts fetch filter isn't being honored ` +
      `or the horizon is set too tight — consider raising "Max days to resolution" in guardrails.`
    )
  }

  // Remove near-certain markets (no edge at extremes)
  const midRange = withinHorizon.filter((m) => m.yes_price >= 0.03 && m.yes_price <= 0.97)

  // Apply category filter post-normalize — our mapCategory bucketing is more
  // reliable than Kalshi's raw category strings.
  const inCategory =
    category && category !== 'All' ? midRange.filter((m) => m.category === category) : midRange

  // Apply min dollar volume filter (default 0 = allow any)
  const aboveVolume = inCategory.filter((m) => (m.volume_24h ?? 0) >= min_volume)

  const normalized = aboveVolume
    // Sort by dollar volume descending (most liquid = most tradeable)
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    // Take top N
    .slice(0, limit)

  if (normalized.length === 0) {
    // If the volume stage did the killing, show the best volume we actually
    // computed — distinguishes "genuinely quiet markets" from "volume field
    // missing, everything is $0".
    const maxVol = inCategory.reduce((mx, m) => Math.max(mx, m.volume_24h ?? 0), 0)
    const funnel =
      `${rawMarkets.length} fetched → ${quoted.length} with live two-sided quotes → ` +
      `${unexpired.length} unexpired` +
      (max_days_to_resolution
        ? ` → ${withinHorizon.length} resolving within ${max_days_to_resolution}d`
        : '') +
      ` → ${midRange.length} priced 3–97¢` +
      (category && category !== 'All' ? ` → ${inCategory.length} in "${category}"` : '') +
      ` → ${aboveVolume.length} above $${min_volume} volume (highest seen: $${maxVol.toFixed(0)})`
    throw new ScanError('no_markets', `No markets survived filtering. Funnel: ${funnel}.`)
  }

  // --- Scan-result reuse cache ----------------------------------------------
  // The Claude call below is the tool's dominant API cost. When the SAME
  // candidate markets at the SAME prices were scanned minutes ago (typical for
  // back-to-back autopilot cycles on quiet markets), re-running Claude buys
  // nothing — the inputs are identical. Reuse the prior result. Any price tick,
  // roster change, or setting change alters the fingerprint → fresh scan.
  const scannerModel = getSettings().scanner_model ?? 'claude-sonnet-5'
  const fingerprint =
    `${scannerModel}|${limit}|${category ?? 'All'}|${min_volume}|${min_effective_edge}|` +
    normalized.map((m) => `${m.id}:${m.yes_price}:${m.no_price}`).join(',')
  const SCAN_CACHE_TTL_MS = 30 * 60 * 1000
  const cacheFile = path.join(
    process.env.DATA_DIR ?? path.join(process.cwd(), 'data'),
    'cache',
    'scan_cache.json'
  )
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    if (
      cached.fingerprint === fingerprint &&
      Date.now() - cached.saved_at < SCAN_CACHE_TTL_MS
    ) {
      const ageMin = Math.round((Date.now() - cached.saved_at) / 60000)
      progress({
        phase: 'analyzing',
        message: `Reusing scan from ${ageMin}m ago — same markets at unchanged prices (no Claude call)`,
        count: normalized.length,
      })
      // Predictions were already logged when this result was produced — never
      // re-log them, regardless of the logPredictions flag.
      return {
        ...cached.result,
        session_notes: `${cached.result.session_notes ? cached.result.session_notes + ' ' : ''}[Reused scan from ${ageMin}m ago — identical markets/prices, no API cost]`,
      }
    }
  } catch {
    // no cache / unreadable cache → fresh scan
  }

  // Step 3: Fetch real-time signals + web context in parallel
  progress({
    phase: 'analyzing',
    message: `Analyzing ${normalized.length} markets with Claude...`,
    count: normalized.length,
  })

  const [signalMap, webContextMap] = await Promise.all([
    getSignalsForMarkets(normalized),
    getWebContextForMarkets(normalized, settings.tavily_api_key || undefined),
  ])

  // Step 4: Run Claude scanner with live signals + web context injected
  const views = getViews()
  const session = getSession()
  const calibration = getCalibrationStats()

  // Get lessons relevant to the actual candidate pool. Previously pinned to a
  // single category/keyword pair derived from the `category` filter param —
  // but that param is usually undefined here (autopilot never passes one,
  // and neither does the manual scanner's "All categories" view), which
  // pinned scanCategory to 'Other/General' with zero keywords in exactly the
  // real-money autopilot path. getRelevantLessons then only surfaces a
  // non-'Other/General' lesson if it happens to be <30 days old (see its
  // scoring), regardless of topical relevance. Query once per distinct
  // category actually present in this batch instead, and merge/dedupe by
  // lesson id. Deliberately NOT touching `category` itself — it also filters
  // the market pool above (inCategory), a separate, correctly-functioning use.
  const candidateCategories = category && category !== 'All'
    ? [category]
    : Array.from(new Set(normalized.map((m) => m.category ?? 'Other/General')))
  const lessonById = new Map<string, Lesson>()
  for (const cat of candidateCategories) {
    for (const l of getRelevantLessons(cat, [cat.toLowerCase()], 5)) {
      lessonById.set(l.id, l)
    }
  }
  const relevantLessons = Array.from(lessonById.values()).slice(0, 5)

  const systemPrompt = buildScannerSystemPrompt(calibration, relevantLessons)
  const userMessage = buildScannerUserMessage(normalized, views, session, signalMap, webContextMap, calibration)

  // Output size scales with market count: Claude writes one JSON entry per
  // market (an opportunity with rationale/key_risk/flags, or a screened_out
  // reason), plus adaptive-thinking tokens reasoning about each one. A flat
  // ceiling truncated mid-response on batches as small as 30 markets — this
  // grows the budget with the actual workload instead. Streaming makes a
  // generous ceiling free when unused (billed on tokens actually produced).
  const scanMaxTokens = Math.min(128000, 24000 + normalized.length * 1200)

  const rawResult = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage, {
    model: scannerModel,
    maxTokens: scanMaxTokens,
    // 'medium' effort, not the default 'high': the scanner is COARSE TRIAGE, not
    // final analysis. Every estimate it produces is shrunk 60/40 toward the
    // market price and re-checked in code before anything trades, so deep
    // per-market reasoning here is largely wasted thinking tokens. Deep analysis
    // still runs at high effort on the single-market Analyze page. This roughly
    // halves the scan's thinking-token spend — the biggest per-scan cost.
    effort: 'medium',
    // Structured outputs: the API constrains generation to this schema, so the
    // response is guaranteed parseable JSON regardless of model quirks.
    jsonSchema: SCAN_JSON_SCHEMA,
  })

  // Parse the response. Structured outputs should make this trivially clean,
  // but keep layered fallbacks (fence-strip, brace-extraction) as a safety net.
  let scanResult: z.infer<typeof ScanResultSchema>
  const cleaned = rawResult.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Last resort: extract the outermost JSON object from surrounding prose
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(cleaned.slice(start, end + 1)) } catch { /* fall through */ }
    }
  }
  if (parsed == null) {
    // Put the actual response in the thrown message (surfaces in the browser
    // toast) instead of only a server log — the prior generic message gave no
    // way to diagnose a recurrence without digging through `npm run dev` output.
    const snippet = rawResult.slice(0, 300).replace(/\s+/g, ' ').trim()
    throw new ScanError(
      'parse',
      `Claude's response wasn't valid JSON. First 300 chars: "${snippet}${rawResult.length > 300 ? '…' : ''}"`
    )
  }
  const repaired = repairScanJson(parsed)
  const zodResult = ScanResultSchema.safeParse(repaired)
  if (!zodResult.success) {
    // Structured outputs guarantees field TYPES but not numeric ranges/business
    // rules, so a schema-shaped-but-out-of-spec response can still reach here.
    const issues = zodResult.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ScanError(
      'parse',
      `Claude's response didn't match the expected schema — ${issues}. Try again, or lower the market count.`
    )
  }
  scanResult = zodResult.data

  // Build a ticker → market map for price lookup. Keys normalized (trim +
  // uppercase) so a cosmetically-mangled ticker from Claude still matches.
  const tickerKey = (t: string | undefined) => (t ?? '').trim().toUpperCase()
  const marketByTicker = new Map(normalized.map((m) => [tickerKey(m.id), m]))

  // Collect code-side rejections so an empty result is explainable in the UI
  // instead of a silent zero.
  const codeScreened: { ticker: string; title: string; reason: string; direction?: 'YES' | 'NO'; edge_pct?: number }[] = []

  // Recompute effective edge in code: shrink Claude's estimate toward market
  // price, subtract Kalshi trading fee, filter weak signals.
  const scored: ScanOpportunity[] = (scanResult.opportunities || [])
    // Drop opportunities whose ticker doesn't match a scanned market — a
    // mangled/hallucinated ticker means we can't verify prices, so we can't
    // trust (or execute) the trade. Fail-safe: skip.
    .filter((opp) => {
      if (marketByTicker.has(tickerKey(opp.ticker))) return true
      codeScreened.push({
        ticker: opp.ticker,
        title: opp.title,
        reason: 'Ticker did not match any scanned market — cannot verify prices',
      })
      return false
    })
    .map((opp): ScanOpportunity => {
      const market = marketByTicker.get(tickerKey(opp.ticker))!
      const p_claude = (opp.my_estimate_pct ?? 50) / 100
      // Anchor shrinkage on the REAL quote, never Claude's self-reported
      // market price — 60% of the blend riding on a hallucinatable number
      // would let the model manufacture its own edge.
      const p_market = market.yes_price
      const p_shrunk = SHRINK_MARKET * p_market + SHRINK_CLAUDE * p_claude

      // Correct execution price per side: YES buyer pays YES ask; NO buyer pays NO ask
      const yes_ask = market.yes_price
      const no_ask = market.no_price
      const execution_price = opp.direction === 'YES' ? yes_ask : no_ask

      // Kalshi fee: coefficient × P × (1−P) where P is execution price.
      // Coefficient is halved on S&P/Nasdaq (INX*/NASDAQ100*) series.
      const fee = kalshiFeeCoef(opp.ticker) * execution_price * (1 - execution_price)

      // Effective edge: shrunk estimate vs execution price, minus fee
      const raw_edge = opp.direction === 'YES'
        ? p_shrunk - execution_price
        : (1 - p_shrunk) - execution_price
      const effective_edge_pct = (raw_edge - fee) * 100

      // Days to resolution → annualized edge, so a 5% edge resolving in a week
      // ranks above a 5% edge resolving in two years (same edge, far more
      // capital-efficient). Floor at 1 day so same-day markets don't divide
      // toward infinity.
      const days_to_resolution = market.resolution_date
        ? Math.max(1, (Date.parse(market.resolution_date) - Date.now()) / (1000 * 60 * 60 * 24))
        : null
      const annualized_edge_pct = days_to_resolution
        ? parseFloat(((effective_edge_pct * 365) / days_to_resolution).toFixed(1))
        : null

      return {
        ...opp,
        edge_pct: parseFloat(effective_edge_pct.toFixed(2)),
        yes_price: market?.yes_price ?? null,
        no_price: market?.no_price ?? null,
        volume_24h: market?.volume_24h ?? null,
        resolution_date: market?.resolution_date ?? null,
        category: market?.category ?? 'Other/General',
        p_shrunk,
        execution_price,
        days_to_resolution,
        annualized_edge_pct,
      }
    })
    // Rank by capital-annualized edge, not raw edge — this decides both display
    // order and (in autopilot) which opportunities get first claim on limited
    // daily-spend/exposure headroom. Undated opportunities fall back to raw
    // edge and sort after every dated one.
    .sort((a, b) => (b.annualized_edge_pct ?? -Infinity) - (a.annualized_edge_pct ?? -Infinity) || b.edge_pct - a.edge_pct)

  // Partition on the effective-edge threshold; rejected ones become visible
  // screened-out entries with the computed number, so "0 opportunities" always
  // comes with receipts (and makes threshold tuning possible).
  const opportunities = scored.filter((opp) => opp.edge_pct >= min_effective_edge * 100)
  for (const opp of scored) {
    if (opp.edge_pct < min_effective_edge * 100) {
      codeScreened.push({
        ticker: opp.ticker,
        title: opp.title,
        reason: `Effective edge ${opp.edge_pct.toFixed(1)}% after shrinkage+fees (needs ≥ ${(min_effective_edge * 100).toFixed(1)}%) — Claude said ${opp.direction} at ${opp.my_estimate_pct}% vs market ${Math.round((opp.yes_price ?? 0) * 100)}%`,
        direction: opp.direction,
        edge_pct: opp.edge_pct,
      })
    }
  }

  // Auto-save scanner opportunities to calibration log (best-effort)
  if (logPredictions) {
    try {
      // A ticker with an unresolved prediction already logged gets re-surfaced
      // every scan until it resolves — without this, the same market racks up
      // duplicate entries (seen in practice: one ticker logged twice 4 minutes
      // apart) and silently inflates by_category/by_source counts.
      const pendingTickers = new Set(
        getPredictions()
          .filter((p) => p.outcome === undefined && p.ticker)
          .map((p) => tickerKey(p.ticker))
      )
      // Log EVERY evaluated market, not just the ones that cleared the edge
      // filter. Logging only actionable rows meant the Claude-vs-market
      // comparison was computed on a sample selected by the very disagreement
      // it was trying to validate — a zero-skill model still looks
      // distinctive under that selection. `scored` is the full pre-filter set.
      const actionableTickers = new Set(opportunities.map((o) => tickerKey(o.ticker)))
      for (const opp of scored) {
        if (!opp.ticker || !opp.direction || (opp.direction as string) === 'NO BET') continue
        if (pendingTickers.has(tickerKey(opp.ticker))) continue
        const market = marketByTicker.get(tickerKey(opp.ticker))
        if (!market) continue
        createPrediction({
          market_title: opp.title || market.title,
          ticker: opp.ticker,
          category: market.category ?? 'Other/General',
          predicted_probability: (opp.my_estimate_pct ?? 50) / 100,
          direction: opp.direction,
          market_price: market.yes_price,
          edge_pct: opp.edge_pct ?? 0,
          resolution_date: market.resolution_date,
          source: 'scanner',
          actionable: actionableTickers.has(tickerKey(opp.ticker)),
          market_yes_bid: market.yes_bid,
          market_yes_ask: market.yes_ask,
          execution_price: opp.execution_price ?? undefined,
          confidence: opp.confidence,
        })
        pendingTickers.add(tickerKey(opp.ticker))
      }
    } catch {
      // prediction logging is non-critical
    }
  }

  const result = {
    opportunities,
    screened_out: [...codeScreened, ...(scanResult.screened_out || [])],
    session_notes: scanResult.session_notes || '',
    markets_scanned: normalized.length,
  }

  // Persist for the reuse cache (best-effort — a write failure never breaks a scan)
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify({ fingerprint, saved_at: Date.now(), result }))
  } catch {
    // cache is an optimization, not a requirement
  }

  return result
}
