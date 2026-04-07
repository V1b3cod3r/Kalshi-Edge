import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings } from '@/lib/storage'
import { buildScannerSystemPrompt, buildScannerUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { fetchMarkets } from '@/lib/kalshi'
import { MarketInput } from '@/lib/types'

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
  // Title: try multiple field names
  const title = m.title || m.question || m.subtitle || m.event_title
  if (!title) return null

  // YES price: Kalshi uses cents (1–99), convert to 0–1
  // Use midpoint of bid/ask when both are non-zero, else fall through candidates
  let yesRaw: number | undefined

  if (m.yes_ask && m.yes_bid) {
    yesRaw = (Number(m.yes_ask) + Number(m.yes_bid)) / 2
  } else {
    // Try each candidate — skip zeros (means no active order)
    for (const candidate of [m.yes_ask, m.yes_bid, m.last_price, m.yes_price]) {
      const n = Number(candidate)
      if (n > 0) { yesRaw = n; break }
    }
  }

  // No valid price found — drop the market rather than guess 50/50
  if (!yesRaw) return null

  // Kalshi prices are in cents (1–99), convert to decimal
  const yes_price = yesRaw > 1 ? yesRaw / 100 : yesRaw
  const no_price = 1 - yes_price

  // Volume: try multiple field names
  const volume_24h = m.volume_24h ?? m.volume ?? m.dollar_volume ?? 0

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

    // Step 1: Fetch live open markets from Kalshi
    const fetchLimit = Math.min(limit * 4, 100) // fetch more than needed so we can filter
    const { markets: rawMarkets } = await fetchMarkets(settings.kalshi_api_key, {
      status: 'open',
      limit: fetchLimit,
      ...(category && category !== 'All' ? { category } : {}),
    })

    // Step 2: Normalize and filter
    const normalized: MarketInput[] = rawMarkets
      .map(normalizeMarket)
      .filter((m): m is MarketInput => m !== null)
      // Remove near-certain markets (no edge at extremes)
      .filter((m) => m.yes_price >= 0.03 && m.yes_price <= 0.97)
      // Drop zero-volume markets entirely — they're illiquid/placeholder and untradeable
      .filter((m) => (m.volume_24h ?? 0) > 0)
      // Apply caller's min volume filter on top
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

    // Step 3: Run Claude scanner
    const views = getViews()
    const session = getSession()

    const systemPrompt = buildScannerSystemPrompt()
    const userMessage = buildScannerUserMessage(normalized, views, session)

    const result = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage)

    return NextResponse.json({
      result,
      markets_scanned: normalized.length,
      markets: normalized,
    })
  } catch (error: any) {
    console.error('Auto-scan error:', error)
    return NextResponse.json(
      { error: error?.message || 'Auto-scan failed' },
      { status: 500 }
    )
  }
}
