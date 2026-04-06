import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/storage'
import { fetchMarkets } from '@/lib/kalshi'

export async function GET(req: NextRequest) {
  try {
    const settings = getSettings()

    if (!settings.kalshi_api_key) {
      return NextResponse.json(
        { error: 'Kalshi API key not configured. Please add it in Settings.' },
        { status: 400 }
      )
    }

    const searchParams = req.nextUrl.searchParams
    const search = searchParams.get('search') || undefined
    const category = searchParams.get('category') || undefined
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20
    const cursor = searchParams.get('cursor') || undefined

    const result = await fetchMarkets(settings.kalshi_api_key, {
      limit,
      cursor,
      search,
      category,
      status: 'open',
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Kalshi markets error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch Kalshi markets' },
      { status: 500 }
    )
  }
}
