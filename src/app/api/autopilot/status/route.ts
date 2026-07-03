import { NextResponse } from 'next/server'
import { getSettings, getAutopilotRuns } from '@/lib/storage'
import { getTodaySpend, realizedPnlTodayFromSettlements } from '@/lib/autopilot'
import { getPortfolioSettlements, KalshiAuth } from '@/lib/kalshi'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = getSettings()
    const lastRun = getAutopilotRuns(1)[0] ?? null

    // Today's realized P&L from Kalshi settlements (best-effort — status must
    // still render when Kalshi creds are missing or the API is down).
    let todayPnl: number | null = null
    if (settings.kalshi_api_key && settings.kalshi_private_key) {
      const auth: KalshiAuth = {
        keyId: settings.kalshi_api_key,
        privateKey: settings.kalshi_private_key,
      }
      try {
        const settlements = await getPortfolioSettlements(auth, 100)
        todayPnl = realizedPnlTodayFromSettlements(settlements)
      } catch {
        todayPnl = null
      }
    }

    return NextResponse.json({
      autopilot: settings.autopilot,
      last_run: lastRun
        ? {
            id: lastRun.id,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            status: lastRun.status,
            dry_run: lastRun.dry_run,
            markets_scanned: lastRun.markets_scanned,
            opportunities_considered: lastRun.opportunities_considered,
            trades_executed: lastRun.trades.filter((t) => t.executed).length,
            trades_total: lastRun.trades.length,
            halted: lastRun.halted,
            error: lastRun.error,
          }
        : null,
      today_spend_usd: getTodaySpend(),
      today_realized_pnl_usd: todayPnl,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load autopilot status' },
      { status: 500 }
    )
  }
}
