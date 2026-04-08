import { NextResponse } from 'next/server'
import { getSettings, getSession } from '@/lib/storage'
import { getPortfolioBalance, getPortfolioPositions, getPortfolioSettlements, KalshiAuth } from '@/lib/kalshi'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = getSettings()
    if (!settings.kalshi_api_key || !settings.kalshi_private_key) {
      return NextResponse.json(
        { error: 'Kalshi API Key ID and Private Key are both required. Configure them in Settings.' },
        { status: 400 }
      )
    }

    const auth: KalshiAuth = {
      keyId: settings.kalshi_api_key,
      privateKey: settings.kalshi_private_key,
    }

    const [balanceData, positionsData, settlementsData] = await Promise.all([
      getPortfolioBalance(auth),
      getPortfolioPositions(auth).catch(() => ({ market_positions: [] })),
      getPortfolioSettlements(auth, 50).catch(() => ({ settlements: [] })),
    ])

    const session = getSession()
    const sessionPosMap = new Map(session.positions.map((p) => [p.market, p]))

    // Normalize positions
    const positions = (balanceData.balance !== undefined
      ? positionsData.market_positions ?? positionsData.positions ?? []
      : []
    ).map((p: any) => {
      const sessionPos = sessionPosMap.get(p.ticker)
      const side = p.position > 0 ? 'YES' : 'NO'
      const qty = Math.abs(p.position ?? p.quantity ?? 0)
      const avgPrice = p.total_traded != null && qty > 0
        ? Math.abs(p.total_traded) / qty / 100  // Kalshi returns cents
        : sessionPos?.avg_price ?? 0
      const currentPrice = p.market?.yes_ask_dollars ?? p.yes_ask ?? avgPrice
      const unrealizedPnl = p.unrealized_pnl != null
        ? p.unrealized_pnl / 100  // cents to dollars
        : (currentPrice - avgPrice) * qty
      const realizedPnl = p.realized_pnl != null ? p.realized_pnl / 100 : 0

      return {
        ticker: p.ticker,
        market_title: p.market?.title ?? sessionPos?.market ?? p.ticker,
        side,
        quantity: qty,
        avg_price: avgPrice,
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
        realized_pnl: realizedPnl,
        total_pnl: unrealizedPnl + realizedPnl,
        category: sessionPos?.category ?? '',
        notional: qty * currentPrice,
      }
    })

    // Realized P&L from settlements
    const settlements = (settlementsData.settlements ?? []).slice(0, 20).map((s: any) => ({
      ticker: s.market_ticker ?? s.ticker,
      title: s.market_title ?? s.ticker,
      revenue: (s.revenue ?? 0) / 100,
      profit: (s.profit ?? 0) / 100,
      settled_at: s.created_time ?? s.settled_time,
    }))

    const balance = (balanceData.balance ?? 0) / 100  // cents to dollars
    const totalUnrealized = positions.reduce((s: number, p: any) => s + p.unrealized_pnl, 0)
    const totalRealized = settlements.reduce((s: number, t: any) => s + t.profit, 0)
    const totalNotional = positions.reduce((s: number, p: any) => s + p.notional, 0)

    return NextResponse.json({
      balance,
      positions,
      settlements,
      summary: {
        total_unrealized_pnl: totalUnrealized,
        total_realized_pnl: totalRealized,
        total_notional: totalNotional,
        position_count: positions.length,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load portfolio' }, { status: 500 })
  }
}
