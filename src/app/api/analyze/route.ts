import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings } from '@/lib/storage'
import { buildAnalysisSystemPrompt, buildAnalysisUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarket } from '@/lib/signals'
import { getMarketWebContext } from '@/lib/search'

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

    // Fetch real-time signals + web context in parallel (best-effort, never blocks)
    const [signals, webContext] = await Promise.all([
      getSignalsForMarket(market.id ?? '', market.id?.split('-')[0]),
      getMarketWebContext(market.title, settings.tavily_api_key || undefined),
    ])

    const systemPrompt = buildAnalysisSystemPrompt()
    const userMessage = buildAnalysisUserMessage(market, views, session, signals, webContext)

    const result = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage)

    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('Analyze error:', error)
    return NextResponse.json(
      { error: error?.message || 'Analysis failed' },
      { status: 500 }
    )
  }
}
