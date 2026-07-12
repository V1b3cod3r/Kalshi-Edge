import { NextResponse } from 'next/server'
import { getSettings, getSession } from '@/lib/storage'
import {
  getPortfolioBalance,
  getPortfolioPositions,
  getPortfolioSettlements,
  fetchMarket,
  positionSignedQuantity,
  positionCostBasisDollars,
  positionRealizedPnlDollars,
  settlementProfitDollars,
  KalshiAuth,
} from '@/lib/kalshi'
import { parseKalshiPrice } from '@/lib/scan'

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

    // Normalize positions. Kalshi's V2 GetPositions response has no nested
    // market object (no title, no live price) — fetchMarket() per ticker
    // supplies both.
    const rawPositions = balanceData.balance !== undefined
      ? positionsData.market_positions ?? positionsData.positions ?? []
      : []
    const positions = await Promise.all(rawPositions.map(async (p: any) => {
      const sessionPos = sessionPosMap.get(p.ticker)
      const signedQty = positionSignedQuantity(p)
      const side = signedQty > 0 ? 'YES' : 'NO'
      const qty = Math.abs(signedQty)
      const costBasis = positionCostBasisDollars(p)
      const avgPrice = qty > 0 ? costBasis / qty : sessionPos?.avg_price ?? 0

      const market = await fetchMarket(null, p.ticker).catch(() => null)
      const yesAsk = market ? parseKalshiPrice(market.yes_ask_dollars, market.yes_ask) : 0
      const currentPrice = yesAsk > 0 ? (side === 'NO' ? 1 - yesAsk : yesAsk) : avgPrice
      const unrealizedPnl = (currentPrice - avgPrice) * qty
      const realizedPnl = positionRealizedPnlDollars(p)

      return {
        ticker: p.ticker,
        market_title: market?.title ?? sessionPos?.market ?? p.ticker,
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
    }))

    // Realized P&L from settlements. V2 has no market_title/profit fields —
    // see settlementProfitDollars() for the computed-profit caveat.
    const settlements = (settlementsData.settlements ?? []).slice(0, 20).map((s: any) => ({
      ticker: s.market_ticker ?? s.ticker,
      title: sessionPosMap.get(s.market_ticker ?? s.ticker)?.market ?? s.market_ticker ?? s.ticker,
      revenue: (Number(s.revenue) || 0) / 100,
      profit: settlementProfitDollars(s),
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
