import { NextResponse } from 'next/server'
import { getSettings, getPredictions } from '@/lib/storage'
import { getPortfolioBalance, getPortfolioPositions, getPortfolioSettlements, KalshiAuth } from '@/lib/kalshi'

export const dynamic = 'force-dynamic'

export interface PnLSummary {
  total_invested: number    // sum of cost basis (revenue - profit) from settlements
  total_returned: number    // sum of revenue from settlements
  total_pnl: number         // sum of profit from settlements (realized)
  open_value: number        // total current value of open positions
  unrealized_pnl: number    // total unrealized P&L from open positions
  win_rate: number          // wins / total settled (0–1)
  wins: number
  losses: number
  total_settled: number
  roi_pct: number           // total_pnl / total_invested * 100
  balance: number           // cash balance
  position_count: number
}

export interface OpenPosition {
  ticker: string
  market_title: string
  side: 'YES' | 'NO'
  contracts: number
  current_value: number     // contracts * current_price
  cost_basis: number        // contracts * avg_price
  unrealized_pnl: number
  avg_price: number
  current_price: number
  category: string
}

export interface Settlement {
  ticker: string
  title: string
  revenue: number           // dollars
  cost: number              // dollars (revenue - profit)
  profit: number            // dollars
  won: boolean
  settled_at: string
  category: string          // from predictions, or 'Other'
  source: 'scanner' | 'analyze' | 'manual' | 'unknown'
}

export interface CategoryBreakdown {
  category: string
  pnl: number
  invested: number
  wins: number
  losses: number
  win_rate: number
  roi_pct: number
}

export interface SourceBreakdown {
  source: string
  pnl: number
  invested: number
  wins: number
  losses: number
  win_rate: number
  roi_pct: number
}

export interface PnLData {
  summary: PnLSummary
  open_positions: OpenPosition[]
  settlements: Settlement[]
  by_category: CategoryBreakdown[]
  by_source: SourceBreakdown[]
}

export async function GET() {
  try {
    const settings = getSettings()
    if (!settings.kalshi_api_key || !settings.kalshi_private_key) {
      return NextResponse.json(
        { error: 'No Kalshi API key configured. Go to Settings to add your Kalshi credentials.' },
        { status: 400 }
      )
    }

    const auth: KalshiAuth = {
      keyId: settings.kalshi_api_key,
      privateKey: settings.kalshi_private_key,
    }

    const [balanceData, positionsData, settlementsData, predictions] = await Promise.all([
      getPortfolioBalance(auth),
      getPortfolioPositions(auth).catch(() => ({ market_positions: [] })),
      getPortfolioSettlements(auth, 100).catch(() => ({ settlements: [] })),
      Promise.resolve(getPredictions()),
    ])

    // Build a lookup map: ticker -> prediction (for enriching settlements with category/source)
    const predByTicker = new Map<string, typeof predictions[0]>()
    for (const p of predictions) {
      if (p.ticker) predByTicker.set(p.ticker, p)
    }

    // Normalize open positions
    const rawPositions: any[] = positionsData.market_positions ?? positionsData.positions ?? []
    const open_positions: OpenPosition[] = rawPositions.map((p: any) => {
      const side: 'YES' | 'NO' = p.position > 0 ? 'YES' : 'NO'
      const contracts = Math.abs(p.position ?? p.quantity ?? 0)
      const avgPrice = p.total_traded != null && contracts > 0
        ? Math.abs(p.total_traded) / contracts / 100
        : 0
      const currentPrice = p.market?.yes_ask_dollars ?? p.yes_ask ?? avgPrice
      const currentValue = contracts * currentPrice
      const costBasis = contracts * avgPrice
      const unrealized = p.unrealized_pnl != null
        ? p.unrealized_pnl / 100
        : currentValue - costBasis
      const pred = predByTicker.get(p.ticker)

      return {
        ticker: p.ticker,
        market_title: p.market?.title ?? p.ticker,
        side,
        contracts,
        current_value: currentValue,
        cost_basis: costBasis,
        unrealized_pnl: unrealized,
        avg_price: avgPrice,
        current_price: currentPrice,
        category: pred?.category ?? '',
      }
    })

    // Normalize settlements (last 20 for display, all for stats)
    const rawSettlements: any[] = settlementsData.settlements ?? []
    const allSettlements: Settlement[] = rawSettlements.map((s: any) => {
      const revenue = (s.revenue ?? 0) / 100
      const profit = (s.profit ?? 0) / 100
      const cost = revenue - profit
      const ticker = s.market_ticker ?? s.ticker ?? ''
      const pred = predByTicker.get(ticker)

      return {
        ticker,
        title: s.market_title ?? ticker,
        revenue,
        cost,
        profit,
        won: profit > 0,
        settled_at: s.created_time ?? s.settled_time ?? '',
        category: pred?.category ?? 'Other',
        source: pred?.source ?? 'unknown',
      }
    })

    // Compute summary stats from all settlements
    const wins = allSettlements.filter((s) => s.profit > 0).length
    const losses = allSettlements.filter((s) => s.profit <= 0).length
    const total_settled = allSettlements.length
    const win_rate = total_settled > 0 ? wins / total_settled : 0
    const total_pnl = allSettlements.reduce((sum, s) => sum + s.profit, 0)
    const total_invested = allSettlements.reduce((sum, s) => sum + Math.max(s.cost, 0), 0)
    const total_returned = allSettlements.reduce((sum, s) => sum + s.revenue, 0)
    const roi_pct = total_invested > 0 ? (total_pnl / total_invested) * 100 : 0
    const open_value = open_positions.reduce((sum, p) => sum + p.current_value, 0)
    const unrealized_pnl = open_positions.reduce((sum, p) => sum + p.unrealized_pnl, 0)
    const balance = (balanceData.balance ?? 0) / 100

    const summary: PnLSummary = {
      total_invested,
      total_returned,
      total_pnl,
      open_value,
      unrealized_pnl,
      win_rate,
      wins,
      losses,
      total_settled,
      roi_pct,
      balance,
      position_count: open_positions.length,
    }

    // Category breakdown (from settlements)
    const catMap = new Map<string, { pnl: number; invested: number; wins: number; losses: number }>()
    for (const s of allSettlements) {
      const cat = s.category || 'Other'
      const existing = catMap.get(cat) ?? { pnl: 0, invested: 0, wins: 0, losses: 0 }
      existing.pnl += s.profit
      existing.invested += Math.max(s.cost, 0)
      if (s.profit > 0) existing.wins++
      else existing.losses++
      catMap.set(cat, existing)
    }
    const by_category: CategoryBreakdown[] = Array.from(catMap.entries())
      .map(([category, stats]) => {
        const total = stats.wins + stats.losses
        return {
          category,
          pnl: stats.pnl,
          invested: stats.invested,
          wins: stats.wins,
          losses: stats.losses,
          win_rate: total > 0 ? stats.wins / total : 0,
          roi_pct: stats.invested > 0 ? (stats.pnl / stats.invested) * 100 : 0,
        }
      })
      .sort((a, b) => b.invested - a.invested)

    // Bot vs Manual breakdown (source)
    const srcMap = new Map<string, { pnl: number; invested: number; wins: number; losses: number }>()
    for (const s of allSettlements) {
      const src = s.source === 'unknown' ? 'manual' : s.source
      const existing = srcMap.get(src) ?? { pnl: 0, invested: 0, wins: 0, losses: 0 }
      existing.pnl += s.profit
      existing.invested += Math.max(s.cost, 0)
      if (s.profit > 0) existing.wins++
      else existing.losses++
      srcMap.set(src, existing)
    }
    const by_source: SourceBreakdown[] = Array.from(srcMap.entries())
      .map(([source, stats]) => {
        const total = stats.wins + stats.losses
        return {
          source,
          pnl: stats.pnl,
          invested: stats.invested,
          wins: stats.wins,
          losses: stats.losses,
          win_rate: total > 0 ? stats.wins / total : 0,
          roi_pct: stats.invested > 0 ? (stats.pnl / stats.invested) * 100 : 0,
        }
      })
      .sort((a, b) => {
        // Put scanner first, then analyze, then manual
        const order: Record<string, number> = { scanner: 0, analyze: 1, manual: 2 }
        return (order[a.source] ?? 9) - (order[b.source] ?? 9)
      })

    const result: PnLData = {
      summary,
      open_positions,
      settlements: allSettlements.slice(0, 20),
      by_category,
      by_source,
    }

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to compute P&L' }, { status: 500 })
  }
}
