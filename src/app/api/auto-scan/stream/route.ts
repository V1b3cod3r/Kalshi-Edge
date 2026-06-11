import { NextRequest } from 'next/server'
import { getViews, getSession, getSettings, getCalibrationStats, createPrediction, getRelevantLessons } from '@/lib/storage'
import { buildScannerSystemPrompt, buildScannerUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { fetchMarkets } from '@/lib/kalshi'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarkets } from '@/lib/signals'
import { getWebContextForMarkets } from '@/lib/search'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

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

  // Volume: always compute 24h dollar volume as contracts × midpoint price.
  const contracts_24h = p(m.volume_24h) || 0
  const mid = (yes_price + (1 - no_price)) / 2
  const volume_24h = contracts_24h * mid

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

const ScanResultSchema = z.object({
  opportunities: z.array(OpportunitySchema),
  screened_out: z.array(ScreenedOutSchema).default([]),
  session_notes: z.string().optional().default(''),
})

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

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
          send({ type: 'error', message: 'Kalshi API key not configured. Please add it in Settings.' })
          controller.close()
          return
        }

        if (!settings.anthropic_api_key) {
          send({ type: 'error', message: 'Anthropic API key not configured. Please add it in Settings.' })
          controller.close()
          return
        }

        // Step 1: Paginate through ALL open markets on Kalshi, streaming progress events.
        send({ type: 'progress', phase: 'fetching', message: 'Fetching open markets from Kalshi...', count: 0 })

        const rawMarkets: any[] = []
        const seenTickers = new Set<string>()
        let cursor: string | null = null
        const MAX_PAGES = 25 // ~5000 markets max; Kalshi usually has <1000 open at once

        for (let page = 0; page < MAX_PAGES; page++) {
          const result: { markets: any[]; cursor: string | null } = await fetchMarkets(null, {
            status: 'open',
            limit: 200,
            ...(cursor ? { cursor } : {}),
          }).catch(() => ({ markets: [] as any[], cursor: null as string | null }))

          for (const m of result.markets) {
            const key = m.ticker || m.id
            if (!key || seenTickers.has(key)) continue
            // Skip MVE parlay bundles — user-created multi-leg combos with no liquidity
            if (m.mve_selected_legs || String(m.ticker ?? '').includes('KXMVE')) continue
            seenTickers.add(key)
            rawMarkets.push(m)
          }

          cursor = result.cursor

          // Send progress update after each page (if we got markets)
          if (rawMarkets.length > 0) {
            const pageNum = page + 1
            send({
              type: 'progress',
              phase: 'fetching',
              message: `Fetched ${rawMarkets.length} markets (page ${pageNum})...`,
              count: rawMarkets.length,
            })
          }

          if (!cursor) break
        }

        // Step 2: Normalize and filter
        send({
          type: 'progress',
          phase: 'filtering',
          message: `Filtering to top ${limit} candidates...`,
          count: rawMarkets.length,
        })

        const now = Date.now()
        let normalized: MarketInput[] = rawMarkets
          .map(normalizeMarket)
          .filter((m): m is MarketInput => m !== null)
          // Safety net: drop markets whose resolution date has passed
          .filter((m) => {
            if (!m.resolution_date) return true
            const ts = Date.parse(m.resolution_date)
            return !Number.isFinite(ts) || ts > now
          })
          // Remove near-certain markets (no edge at extremes)
          .filter((m) => m.yes_price >= 0.03 && m.yes_price <= 0.97)

        // Apply category filter post-normalize
        if (category && category !== 'All') {
          normalized = normalized.filter((m) => m.category === category)
        }

        normalized = normalized
          // Apply min dollar volume filter
          .filter((m) => (m.volume_24h ?? 0) >= min_volume)
          // Sort by dollar volume descending
          .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
          // Take top N
          .slice(0, limit)

        if (normalized.length === 0) {
          send({ type: 'error', message: 'No markets found matching your filters. Try loosening the filters.' })
          controller.close()
          return
        }

        // Step 3: Fetch real-time signals + web context in parallel
        send({
          type: 'progress',
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

        const scanCategory = category && category !== 'All' ? category : 'Other/General'
        const scanKeywords = category && category !== 'All' ? [category.toLowerCase()] : []
        const relevantLessons = getRelevantLessons(scanCategory, scanKeywords, 5)

        const systemPrompt = buildScannerSystemPrompt(calibration, relevantLessons)
        const userMessage = buildScannerUserMessage(normalized, views, session, signalMap, webContextMap, calibration)

        const rawResult = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage)

        // Parse Claude's JSON response
        let scanResult: { opportunities: any[]; screened_out: any[]; session_notes: string } = {
          opportunities: [],
          screened_out: [],
          session_notes: '',
        }
        const cleaned = rawResult.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
        try {
          const parsed = JSON.parse(cleaned)
          scanResult = ScanResultSchema.parse(parsed)
        } catch {
          send({ type: 'error', message: 'Claude returned an unexpected format. Please try again.' })
          controller.close()
          return
        }

        // Build a ticker → market map for price lookup
        const marketByTicker = new Map(normalized.map((m) => [m.id, m]))

        // Recompute effective edge in code
        const SHRINK_MARKET = 0.60
        const SHRINK_CLAUDE = 0.40
        const MIN_EFFECTIVE_EDGE = 0.07

        const opportunities = (scanResult.opportunities || []).map((opp: any) => {
          const market = marketByTicker.get(opp.ticker)
          const p_claude = (opp.my_estimate_pct ?? 50) / 100
          const p_market = (opp.market_price_pct ?? 50) / 100
          const p_shrunk = SHRINK_MARKET * p_market + SHRINK_CLAUDE * p_claude

          const yes_ask = market?.yes_price ?? p_market
          const no_ask = market?.no_price ?? (1 - p_market)
          const execution_price = opp.direction === 'YES' ? yes_ask : no_ask

          const fee = 0.07 * execution_price * (1 - execution_price)

          const raw_edge = opp.direction === 'YES'
            ? p_shrunk - execution_price
            : (1 - p_shrunk) - execution_price
          const effective_edge_pct = (raw_edge - fee) * 100

          return {
            ...opp,
            edge_pct: parseFloat(effective_edge_pct.toFixed(2)),
            yes_price: market?.yes_price ?? null,
            no_price: market?.no_price ?? null,
            volume_24h: market?.volume_24h ?? null,
            resolution_date: market?.resolution_date ?? null,
          }
        })
        .filter((opp: any) => opp.edge_pct >= MIN_EFFECTIVE_EDGE * 100)
        .sort((a: any, b: any) => b.edge_pct - a.edge_pct)

        // Auto-save scanner opportunities to calibration log (best-effort)
        try {
          for (const opp of opportunities) {
            if (!opp.ticker || !opp.direction || opp.direction === 'NO BET') continue
            const market = marketByTicker.get(opp.ticker)
            if (!market) continue
            createPrediction({
              market_title: opp.title || market.title,
              ticker: opp.ticker,
              category: market.category ?? 'Other/General',
              predicted_probability: (opp.my_estimate_pct ?? 50) / 100,
              direction: opp.direction as 'YES' | 'NO',
              market_price: market.yes_price,
              edge_pct: opp.edge_pct ?? 0,
              resolution_date: market.resolution_date,
              source: 'scanner',
            })
          }
        } catch {
          // prediction logging is non-critical
        }

        send({
          type: 'done',
          opportunities,
          screened_out: scanResult.screened_out || [],
          session_notes: scanResult.session_notes || '',
          markets_scanned: normalized.length,
        })
        controller.close()
      } catch (error: any) {
        console.error('Auto-scan stream error:', error)
        try {
          send({ type: 'error', message: error?.message || 'Auto-scan failed' })
        } catch {
          // controller may already be closed
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
