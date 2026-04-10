import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings, getCalibrationStats, createPrediction } from '@/lib/storage'
import { buildAnalysisSystemPrompt, buildAnalysisUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarket } from '@/lib/signals'
import { getMarketWebContext } from '@/lib/search'

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
  const predicted_probability = probPct !== null ? probPct / 100 : market.yes_price

  // Edge magnitude
  const edgeMatch = markdown.match(/\*\*Edge\*\*[:\s]+[+\-]?(\d+(?:\.\d+)?)%/)
  const edge_pct = edgeMatch ? parseFloat(edgeMatch[1]) : 0

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

    // Fetch real-time signals + web context in parallel (best-effort, never blocks)
    const [signals, webContext] = await Promise.all([
      getSignalsForMarket(market.id ?? '', market.id?.split('-')[0]),
      getMarketWebContext(market.title, settings.tavily_api_key || undefined),
    ])

    const systemPrompt = buildAnalysisSystemPrompt(calibration)
    const userMessage = buildAnalysisUserMessage(market, views, session, signals, webContext)

    const result = await callClaude(
      settings.anthropic_api_key,
      systemPrompt,
      userMessage,
      { extendedThinking: settings.use_extended_thinking ?? false }
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
