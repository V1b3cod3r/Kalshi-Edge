import { NextRequest, NextResponse } from 'next/server'
import { getSettings, getSession, saveSession } from '@/lib/storage'
import { placeOrder } from '@/lib/kalshi'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { ticker, side, count, price_cents, title } = body

    // Validate required fields
    if (!ticker) return NextResponse.json({ error: 'Market ticker is required' }, { status: 400 })
    if (side !== 'yes' && side !== 'no') return NextResponse.json({ error: 'Side must be yes or no' }, { status: 400 })
    if (!count || count < 1) return NextResponse.json({ error: 'Count must be at least 1 contract' }, { status: 400 })
    if (!price_cents || price_cents < 1 || price_cents > 99) {
      return NextResponse.json({ error: 'Price must be between 1 and 99 cents' }, { status: 400 })
    }

    const settings = getSettings()
    if (!settings.kalshi_api_key) {
      return NextResponse.json({ error: 'Kalshi API key not configured. Add it in Settings.' }, { status: 400 })
    }

    // Safety: cap dollar exposure
    const session = getSession()
    const totalCost = (count * price_cents) / 100
    const maxDollars = Math.min(
      settings.max_position_pct * session.current_bankroll,
      500 // hard cap at $500 per trade
    )
    if (totalCost > maxDollars) {
      return NextResponse.json(
        { error: `Order size $${totalCost.toFixed(2)} exceeds safety limit $${maxDollars.toFixed(2)}. Reduce contracts or adjust Max Position Size in Settings.` },
        { status: 400 }
      )
    }

    // Place the order
    const result = await placeOrder(settings.kalshi_api_key, {
      ticker,
      side,
      count,
      price_cents,
    })

    // Record position in session
    const newPosition = {
      id: result.order_id,
      market: ticker,
      direction: side.toUpperCase() as 'YES' | 'NO',
      contracts: count,
      avg_price: price_cents / 100,
      current_price: price_cents / 100,
      category: body.category || '',
      corr_group: body.corr_group || ticker.split('-')[0],
    }
    session.positions.push(newPosition)
    saveSession(session)

    return NextResponse.json({
      order: result,
      position: newPosition,
      total_cost: totalCost,
    })
  } catch (error: any) {
    console.error('Trade execution error:', error)
    return NextResponse.json(
      { error: error?.message || 'Trade execution failed' },
      { status: 500 }
    )
  }
}
