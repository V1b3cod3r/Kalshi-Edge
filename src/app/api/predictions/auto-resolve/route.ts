import { NextResponse } from 'next/server'
import { getPredictions, resolvePrediction, getSettings } from '@/lib/storage'
import { fetchMarket } from '@/lib/kalshi'
import { extractLessonForPrediction } from '@/lib/lessons'

export const dynamic = 'force-dynamic'

interface ResolvedSummary {
  market_title: string
  ticker: string
  outcome: 'YES' | 'NO'
  was_correct: boolean
}

/**
 * Check all pending predictions against Kalshi and auto-resolve any that
 * have settled. For wrong predictions, kick off lesson extraction.
 */
export async function POST() {
  try {
    const settings = getSettings()

    // Kalshi auth — optional for public market reads, but needed for higher limits
    const auth =
      settings.kalshi_api_key && settings.kalshi_private_key
        ? { keyId: settings.kalshi_api_key, privateKey: settings.kalshi_private_key }
        : null

    const allPredictions = getPredictions()
    const pending = allPredictions.filter((p) => p.outcome == null && p.ticker)

    if (pending.length === 0) {
      return NextResponse.json({ checked: 0, resolved: 0, still_pending: 0, newly_resolved: [] })
    }

    // Check all pending in parallel (Kalshi public reads are fast + no strict rate limit)
    const results = await Promise.allSettled(
      pending.map(async (pred) => {
        const market = await fetchMarket(auth, pred.ticker!)

        // Determine if the market has settled
        const result = (market.result || '').toLowerCase()
        const status = (market.status || '').toLowerCase()

        // Use result field as primary settlement indicator — more reliable than status
        // strings which can vary (settled/finalized/resolved). If result is yes/no the
        // market has definitively resolved regardless of the status label.
        const hasResult = result === 'yes' || result === 'no'
        const isSettledByStatus = status === 'settled' || status === 'finalized' || status === 'resolved'
        if ((!hasResult && !isSettledByStatus) || result === 'void') return null
        if (!hasResult) return null  // status says settled but no result yet — skip

        // Map Kalshi result to our YES/NO outcome
        const outcome: 'YES' | 'NO' = result === 'yes' ? 'YES' : 'NO'

        const resolved = resolvePrediction(pred.id, outcome)
        const was_correct = resolved.direction === outcome

        // Fire-and-forget lesson extraction for losses
        if (!was_correct && settings.anthropic_api_key) {
          extractLessonForPrediction(resolved, settings.anthropic_api_key).catch(() => {})
        }

        return {
          market_title: pred.market_title,
          ticker: pred.ticker!,
          outcome,
          was_correct,
        } as ResolvedSummary
      })
    )

    const newly_resolved: ResolvedSummary[] = results
      .filter((r): r is PromiseFulfilledResult<ResolvedSummary | null> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value as ResolvedSummary)

    return NextResponse.json({
      checked: pending.length,
      resolved: newly_resolved.length,
      still_pending: pending.length - newly_resolved.length,
      newly_resolved,
    })
  } catch (error: any) {
    console.error('Auto-resolve error:', error)
    return NextResponse.json({ error: error?.message || 'Auto-resolve failed' }, { status: 500 })
  }
}
