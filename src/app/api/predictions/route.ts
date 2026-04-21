import { NextRequest, NextResponse } from 'next/server'
import { getPredictions, createPrediction } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ predictions: getPredictions() })
  } catch {
    return NextResponse.json({ error: 'Failed to load predictions' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { market_title, ticker, category, predicted_probability, direction,
            market_price, edge_pct, resolution_date, notes, source } = body

    if (!market_title) return NextResponse.json({ error: 'market_title required' }, { status: 400 })
    if (predicted_probability == null || direction == null) {
      return NextResponse.json({ error: 'predicted_probability and direction required' }, { status: 400 })
    }

    const prediction = createPrediction({
      market_title,
      ticker,
      category: category || 'Other/General',
      predicted_probability,
      direction,
      market_price: market_price ?? 0,
      edge_pct: edge_pct ?? 0,
      resolution_date,
      notes,
      source: source || 'manual',
    })
    return NextResponse.json({ prediction })
  } catch {
    return NextResponse.json({ error: 'Failed to create prediction' }, { status: 500 })
  }
}
