import Anthropic from '@anthropic-ai/sdk'
import { Prediction } from './types'
import { createLesson, updatePrediction } from './storage'

/**
 * Call Claude to perform a post-mortem on a wrong prediction, extract a
 * structured lesson, persist it, and link it back to the prediction.
 * This is best-effort — all errors are swallowed so the caller never fails.
 */
export async function extractLessonForPrediction(
  prediction: Prediction,
  apiKey: string
): Promise<void> {
  try {
    const client = new Anthropic({ apiKey })

    const systemPrompt = `You are a prediction market analyst performing a post-mortem on a wrong prediction. Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text.`

    const userMessage = `Analyze this failed prediction and extract a lesson.

Market: "${prediction.market_title}"
Category: ${prediction.category}
Our bet direction: ${prediction.direction}
Our P(YES) estimate: ${Math.round(prediction.predicted_probability * 100)}%
Market implied P(YES): ${Math.round(prediction.market_price * 100)}%
Actual outcome: ${prediction.outcome}
Edge claimed: ${prediction.edge_pct.toFixed(1)}%

Output this JSON object:
{
  "what_went_wrong": "1-2 sentence specific analysis of the analytical mistake made",
  "what_to_do_differently": "1-2 sentence actionable recommendation for similar future markets",
  "mistake_type": "one of: overconfidence | base_rate_neglect | anchoring | news_overreaction | thin_market | timing_error | other",
  "keywords": ["3-5 keywords extracted from the market title useful for matching similar markets"]
}`

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const textBlock = message.content.find((b: any) => b.type === 'text')
    if (!textBlock) return

    const raw = (textBlock as any).text.trim()
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(jsonStr)

    const lesson = createLesson({
      prediction_id: prediction.id,
      market_title: prediction.market_title,
      category: prediction.category,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
      predicted_direction: prediction.direction,
      actual_outcome: prediction.outcome!,
      predicted_probability: prediction.predicted_probability,
      market_price: prediction.market_price,
      edge_pct: prediction.edge_pct,
      what_went_wrong: parsed.what_went_wrong || '',
      what_to_do_differently: parsed.what_to_do_differently || '',
      mistake_type: parsed.mistake_type || 'other',
    })

    updatePrediction(prediction.id, { lesson_id: lesson.id })
  } catch {
    // Lesson extraction is best-effort — never propagate errors
  }
}
