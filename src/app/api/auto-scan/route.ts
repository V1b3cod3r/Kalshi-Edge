import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings } from '@/lib/storage'
import { buildScannerSystemPrompt, buildScannerUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { fetchMarkets } from '@/lib/kalshi'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarkets } from '@/lib/signals'
import { getWebContextForMarkets } from '@/lib/search'

// Maps Kalshi category strings to our 4 standard categories
function mapCategory(kalshiCategory: string | undefined): string {
  if (!kalshiCategory) return 'Other/General'
  const c = kalshiCategory.toLowerCase()
  if (c.includes('polit') || c.includes('elect') || c.includes('gov') || c.includes('president')) {
    return 'Politics & Elections'
  }
  if (c.includes('econ') || c.includes('financ') || c.includes('fed') || c.includes('market') ||
      c.includes('crypto') || c.includes('stock') || c.includes('rate') || c.includes('gdp') ||
      c.includes('inflation') || c.includes('cpi')) {
    return 'Economics/Finance'
  }
  if (c.includes('sport') || c.includes('nfl') || c.includes('nba') || c.includes('mlb') ||
      c.includes('nhl') || c.includes('soccer') || c.includes('tennis') || c.includes('golf')) {
    return 'Sports'
  }
  return 'Other/General'
}

// Normalize a Kalshi market object (whose shape can vary) into our MarketInput
function normalizeMarket(m: any): MarketInput | null {
  // Skip MVE parlay bundles — user-created multi-leg combos with no real liquidity
  if (m.mve_selected_legs || (m.ticker && String(m.ticker).includes('KXMVE'))) return null

  // Title: try multiple field names
  const title = m.title || m.question || m.subtitle || m.event_title
  if (!title) return null

  // Use ask prices for order placement — bidding at ask fills immediately.
  // Midpoint would leave orders resting below the ask.
  let yes_price: number | undefined
  let no_price: number | undefined

  // Helper: parse a price value that may be a string or number
  const p = (v: any): number => (v == null ? 0 : Number(v))

  const ya = p(m.yes_ask_dollars ?? m.yes_ask)
  const yb = p(m.yes_bid_dollars ?? m.yes_bid)
  const na = p(m.no_ask_dollars ?? m.no_ask)
  const nb = p(m.no_bid_dollars ?? m.no_bid)
  const last = p(m.last_price_dollars ?? m.last_price)

  // YES ask (cost to buy YES)
  if (ya > 0) {
    yes_price = ya
  } else if (yb > 0) {
    yes_price = yb
  } else if (na > 0) {
    yes_price = 1 - na
  } else if (nb > 0) {
    yes_price = 1 - nb
  } else if (last > 0) {
    yes_price = last
  }

  // NO ask (cost to buy NO)
  if (na > 0) {
    no_price = na
  } else if (nb > 0) {
    no_price = nb
  }

  // Legacy cent-based prices (1–99): convert to decimal BEFORE deriving no_price
  if (yes_price !== undefined && yes_price > 1) yes_price = yes_price / 100
  if (no_price !== undefined && no_price > 1) no_price = no_price / 100

  // Derive no_price from converted yes_price if not available directly
  if (no_price === undefined && yes_price !== undefined) {
    no_price = parseFloat((1 - yes_price).toFixed(4))
  }

  // No valid price found — drop the market
  if (!yes_price || !no_price) return null

  // Volume: Kalshi returns volume_24h_fp / volume_fp as decimal dollar strings
  const volume_24h =
    p(m.volume_24h_fp ?? m.volume_24h) ||
    p(m.volume_fp ?? m.volume) ||
    p(m.dollar_volume) ||
    0

  // Resolution date
  const resolution_date = m.close_time || m.expiration_time || m.expected_expiration_ts || undefined

  // Resolution criteria
  const resolution_criteria =
    m.rules_primary || m.settlement_source_description || m.subtitle || undefined

  // Category
  const category = mapCategory(m.category || m.event_category)

  // Ticker as ID
  const id = m.ticker || m.id || undefined

  return {
    id,
    title: String(title),
    yes_price,
    no_price,
    volume_24h: Number(volume_24h) || 0,
    resolution_date: resolution_date ? String(resolution_date) : undefined,
    resolution_criteria: resolution_criteria ? String(resolution_criteria) : undefined,
    category,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      category,
      limit = 15,
      min_volume = 0,
    }: {
      category?: string
      limit?: number
      min_volume?: number
    } = body

    const settings = getSettings()

    if (!settings.kalshi_api_key) {
      return NextResponse.json(
        { error: 'Kalshi API key not configured. Please add it in Settings.' },
        { status: 400 }
      )
    }

    if (!settings.anthropic_api_key) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured. Please add it in Settings.' },
        { status: 400 }
      )
    }

    // Known Kalshi series with real liquid markets, grouped by category
    const SERIES_BY_CATEGORY: Record<string, string[]> = {
      'Economics/Finance': [
        'KXCPI', 'KXGDP', 'GDP', 'KXPCECORE', 'KXRATECUT', 'KXRATECUTCOUNT',
        'KXJOBLESS', 'KXFRM', 'KXECB', 'KXBOE', 'OILW', 'KXNATGASMON',
        'KXISMSERVICES', 'KXUSRETAIL', 'KXFEDDECISION', 'KXFEDRATEMIN',
        'NASDAQ100', 'INXU', 'INXW', 'INXD', 'KXBTC', 'KXETH', 'KXSOL', 'KXSOLE',
      ],
      'Politics & Elections': [
        'PRES', 'KXNEWTARIFFS', 'KXTARIFFSPRC', 'KXTARIFFCAN', 'KXTARIFFSEU',
        'KXDCEIL', 'KXGOVTSHUTDOWN', 'KXTRUMPCHINA', 'KXSHUTLENGTH',
        'KXRECNCH', 'KXRECSS', 'BBB',
      ],
      'Sports': [
        'KXNBA', 'KXNFL', 'KXMLB', 'KXNHL',
      ],
      'Other/General': [
        'KXAI', 'KXTECH',
      ],
    }

    const seriesToFetch = category && category !== 'All'
      ? (SERIES_BY_CATEGORY[category] ?? [])
      : Object.values(SERIES_BY_CATEGORY).flat()

    // Step 1: Fetch markets from known series in parallel
    let rawMarkets: any[] = []

    if (seriesToFetch.length > 0) {
      const results = await Promise.all(
        seriesToFetch.map((series) =>
          fetchMarkets(null, {
            series_ticker: series,
            limit: 50,
          }).catch(() => ({ markets: [], cursor: null }))
        )
      )
      rawMarkets = results.flatMap((r) => r.markets)
    }

    // Deduplicate by ticker — same market can appear across multiple series queries
    const seenTickers = new Set<string>()
    rawMarkets = rawMarkets.filter((m: any) => {
      const key = m.ticker || m.id
      if (!key || seenTickers.has(key)) return false
      seenTickers.add(key)
      return true
    })

    // Fallback: if series queries returned nothing, page through generic endpoint
    if (rawMarkets.length === 0) {
      let cursor: string | null = null
      for (let page = 0; page < 10; page++) {
        const result = await fetchMarkets(null, {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })
        const nonMve = result.markets.filter(
          (m: any) => !m.mve_selected_legs && !String(m.ticker ?? '').includes('KXMVE')
        )
        rawMarkets.push(...nonMve)
        cursor = result.cursor
        if (rawMarkets.length >= limit * 4 || !cursor) break
      }
    }

    // Step 2: Normalize and filter
    const normalized: MarketInput[] = rawMarkets
      .map(normalizeMarket)
      .filter((m): m is MarketInput => m !== null)
      // Remove near-certain markets (no edge at extremes)
      .filter((m) => m.yes_price >= 0.03 && m.yes_price <= 0.97)
      // Apply min volume filter (default 0 = allow any)
      .filter((m) => (m.volume_24h ?? 0) >= min_volume)
      // Sort by volume descending (most liquid = most tradeable)
      .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
      // Take top N
      .slice(0, limit)

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: 'No markets found matching your filters. Try loosening the filters.' },
        { status: 404 }
      )
    }

    // Step 3: Fetch real-time signals + web context in parallel
    const [signalMap, webContextMap] = await Promise.all([
      getSignalsForMarkets(normalized),
      getWebContextForMarkets(normalized, settings.tavily_api_key || undefined),
    ])

    // Step 4: Run Claude scanner with live signals + web context injected
    const views = getViews()
    const session = getSession()

    const systemPrompt = buildScannerSystemPrompt()
    const userMessage = buildScannerUserMessage(normalized, views, session, signalMap, webContextMap)

    const rawResult = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage)

    // Parse Claude's JSON response
    let scanResult: { opportunities: any[]; screened_out: any[]; session_notes: string } = {
      opportunities: [],
      screened_out: [],
      session_notes: '',
    }
    try {
      // Strip any accidental markdown fences Claude might add
      const cleaned = rawResult.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      scanResult = JSON.parse(cleaned)
    } catch {
      // If JSON parsing fails, return error so user knows to retry
      return NextResponse.json(
        { error: 'Claude returned an unexpected format. Please try again.' },
        { status: 500 }
      )
    }

    // Build a ticker → market map for price lookup
    const marketByTicker = new Map(normalized.map((m) => [m.id, m]))

    // Attach live prices to each opportunity
    const opportunities = (scanResult.opportunities || []).map((opp: any) => {
      const market = marketByTicker.get(opp.ticker)
      return {
        ...opp,
        yes_price: market?.yes_price ?? null,
        no_price: market?.no_price ?? null,
        volume_24h: market?.volume_24h ?? null,
        resolution_date: market?.resolution_date ?? null,
      }
    })

    return NextResponse.json({
      opportunities,
      screened_out: scanResult.screened_out || [],
      session_notes: scanResult.session_notes || '',
      markets_scanned: normalized.length,
    })
  } catch (error: any) {
    console.error('Auto-scan error:', error)
    return NextResponse.json(
      { error: error?.message || 'Auto-scan failed' },
      { status: 500 }
    )
  }
}
