import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSettings, getCalibrationStats } from '@/lib/storage'
import { buildPortfolioSystemPrompt, buildPortfolioUserMessage } from '@/lib/prompts'
import { callClaude } from '@/lib/claude'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const opportunities = body.opportunities ?? []

    const settings = getSettings()
    if (!settings.anthropic_api_key) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured. Please add it in Settings.' },
        { status: 400 }
      )
    }

    const session = getSession()
    const calibration = getCalibrationStats()

    const systemPrompt = buildPortfolioSystemPrompt(calibration)
    const userMessage = buildPortfolioUserMessage(session, opportunities)

    const result = await callClaude(
      settings.anthropic_api_key,
      systemPrompt,
      userMessage,
      { effort: settings.use_extended_thinking ? 'max' : 'high' }
    )

    return NextResponse.json({ result })
  } catch (error: any) {
    console.error('Portfolio scan error:', error)
    return NextResponse.json(
      { error: error?.message || 'Portfolio scan failed' },
      { status: 500 }
    )
  }
}
