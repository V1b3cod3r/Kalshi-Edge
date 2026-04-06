import { NextRequest, NextResponse } from 'next/server'
import { getViews, getSession, getSettings } from '@/lib/storage'
import { buildScannerSystemPrompt, buildScannerUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'
import { MarketInput } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const markets: MarketInput[] = body.markets

    if (!markets || markets.length === 0) {
      return NextResponse.json({ error: 'At least one market is required' }, { status: 400 })
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

    const systemPrompt = buildScannerSystemPrompt()
    const userMessage = buildScannerUserMessage(markets, views, session)

    const result = await callClaude(settings.anthropic_api_key, systemPrompt, userMessage)

    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('Scanner error:', error)
    return NextResponse.json(
      { error: error?.message || 'Scanner failed' },
      { status: 500 }
    )
  }
}
