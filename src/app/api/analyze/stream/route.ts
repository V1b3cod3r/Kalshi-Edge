import { NextRequest } from 'next/server'
import { getViews, getSession, getSettings, getCalibrationStats, createPrediction, getRelevantLessons } from '@/lib/storage'
import { buildAnalysisSystemPrompt, buildAnalysisUserMessage } from '@/lib/prompts'
import { callClaudeStream } from '@/lib/claude'
import { MarketInput } from '@/lib/types'
import { getSignalsForMarket } from '@/lib/signals'
import { getMarketWebContext } from '@/lib/search'

export const dynamic = 'force-dynamic'

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
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      try {
        const body = await req.json()
        const market: MarketInput = body.market

        if (!market || !market.title) {
          send({ type: 'error', message: 'Market data is required' })
          controller.close()
          return
        }

        const settings = getSettings()

        if (!settings.anthropic_api_key) {
          send({ type: 'error', message: 'Anthropic API key not configured. Please add it in Settings.' })
          controller.close()
          return
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
          getSignalsForMarket(market.id ?? '', market.id?.split('-')[0]),
          getMarketWebContext(market.title, settings.tavily_api_key || undefined),
        ])

        const systemPrompt = buildAnalysisSystemPrompt(calibration, relevantLessons)
        const userMessage = buildAnalysisUserMessage(market, views, session, signals, webContext)

        // Determine effort level: ultraMode overrides settings
        const effort = body.ultraMode
          ? 'xhigh'
          : (settings.use_extended_thinking ? 'max' : 'high')

        const { text } = await callClaudeStream(
          settings.anthropic_api_key,
          systemPrompt,
          userMessage,
          {
            effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
            onThinking: (chunk) => {
              send({ type: 'thinking', text: chunk })
            },
            onText: (chunk) => {
              send({ type: 'text', text: chunk })
            },
          }
        )

        // Auto-save prediction to calibration log (best-effort, never blocks)
        try {
          const pred = extractPrediction(text, market)
          if (pred) createPrediction(pred)
        } catch {
          // prediction logging is non-critical
        }

        send({ type: 'done' })
        controller.close()
      } catch (error: any) {
        console.error('Stream analyze error:', error)
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Analysis failed' })}\n\n`)
          )
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
