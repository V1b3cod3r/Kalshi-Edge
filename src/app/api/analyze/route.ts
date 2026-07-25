import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings, getCalibrationStats, createPrediction, getRelevantLessons } from '@/lib/storage'
import { buildAnalysisSystemPrompt, buildAnalysisUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarket } from '@/lib/signals'
import { getMarketWebContext } from '@/lib/search'
import { SHRINK_MARKET, SHRINK_CLAUDE, KALSHI_FEE_COEF } from '@/lib/scan'

/**
 * Extract a structured prediction from Claude's markdown analysis output.
 * Returns null if no actionable trade recommendation was found.
 */
function extractPrediction(
  markdown: string,
  market: MarketInput
): Omit<import('@/lib/types').Prediction, 'id' | 'created_at'> | null {
  // Direction — only save if a concrete bet was recommended
  const dirMatch = markdown.match(/\*\*Direction\*\*[:\s]+([A-Z ]+)/i)
  if (!dirMatch) return null
  const dirRaw = dirMatch[1].trim().toUpperCase()
  if (dirRaw === 'NO BET' || dirRaw === 'NO_BET') return null
  if (dirRaw !== 'YES' && dirRaw !== 'NO') return null
  const direction = dirRaw as 'YES' | 'NO'

  // Probability — prefer view-adjusted, fall back to data-only
  const adjMatch = markdown.match(/[Vv]iew.adjusted estimate[:\s]+(\d+)%/)
  const dataMatch = markdown.match(/[Mm]y estimate.*?[:\s]+(\d+)%/)
  const probPct = adjMatch ? parseInt(adjMatch[1]) : dataMatch ? parseInt(dataMatch[1]) : null
  // If Claude gave a direction but no parseable probability, skip saving rather than
  // defaulting to market price (which would create a zero-edge prediction and corrupt
  // calibration stats).
  if (probPct === null) return null
  const predicted_probability = probPct / 100

  // Effective edge recomputed in code (mirrors the scanner): shrink Claude's
  // estimate toward the market price and subtract the Kalshi fee at the
  // execution price. Never store Claude's self-reported edge — it isn't
  // comparable with scanner edges and can be arithmetic fiction.
  const p_shrunk = SHRINK_MARKET * market.yes_price + SHRINK_CLAUDE * predicted_probability
  // Manual entry may lack a NO quote; 1 − yes_price is optimistic there, but
  // there is no orderbook to do better with.
  const exec = direction === 'YES' ? market.yes_price : (market.no_price ?? 1 - market.yes_price)
  const fee = KALSHI_FEE_COEF * exec * (1 - exec)
  const raw_edge = direction === 'YES' ? p_shrunk - exec : (1 - p_shrunk) - exec
  const edge_pct = parseFloat(((raw_edge - fee) * 100).toFixed(2))

  return {
    market_title: market.title,
    ticker: market.id,
    category: market.category ?? 'Other/General',
    predicted_probability,
    direction,
    market_price: market.yes_price,
    edge_pct,
    resolution_date: market.resolution_date,
    source: 'analyze',
    // Deep analysis only produces a row when Claude recommends a concrete
    // bet, so every row here is by definition actionable.
    actionable: true,
    market_yes_bid: market.yes_bid,
    market_yes_ask: market.yes_ask ?? market.yes_price,
    execution_price: exec,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const market: MarketInput = body.market

    if (!market || !market.title) {
      return NextResponse.json({ error: 'Market data is required' }, { status: 400 })
    }

    const settings = getSettings()

    if (!settings.anthropic_api_key) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured. Please add it in Settings.' },
        { status: 400 }
      )
    }

    const views = getViews()
    const session = getSession()
    const calibration = getCalibrationStats()

    // Extract keywords from market title for lesson matching
    const titleKeywords = market.title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
    const relevantLessons = getRelevantLessons(market.category ?? 'Other/General', titleKeywords, 3)

    // Fetch real-time signals + web context in parallel (best-effort, never blocks)
    const [signals, webContext] = await Promise.all([
      // marketTitle was never passed here — the title-text weather/CPI
      // detection fallbacks had nothing to check on this route at all.
      getSignalsForMarket(market.id ?? '', market.id?.split('-')[0], market.title),
      getMarketWebContext(market.title, settings.tavily_api_key || undefined),
    ])

    const systemPrompt = buildAnalysisSystemPrompt(calibration, relevantLessons)
    const userMessage = buildAnalysisUserMessage(market, views, session, signals, webContext, calibration)

    const result = await callClaude(
      settings.anthropic_api_key,
      systemPrompt,
      userMessage,
      // Map legacy use_extended_thinking: true → effort 'max', false → 'high'
      { effort: settings.use_extended_thinking ? 'max' : 'high' }
    )

    // Auto-save prediction to calibration log (best-effort, never blocks response)
    try {
      const pred = extractPrediction(result, market)
      if (pred) createPrediction(pred)
    } catch {
      // prediction logging is non-critical
    }

    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('Analyze error:', error)
    return NextResponse.json(
      { error: error?.message || 'Analysis failed' },
      { status: 500 }
    )
  }
}
