import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/storage'
import { fetchMarkets } from '@/lib/kalshi'

export async function GET() {
  const settings = getSettings()
  if (!settings.kalshi_api_key) {
    return NextResponse.json({ error: 'No API key' }, { status: 400 })
  }

  // Page through until we find 3 non-MVE markets
  const found: any[] = []
  let cursor: string | null = null
  let pagesChecked = 0

  while (found.length < 3 && pagesChecked < 10) {
    const result = await fetchMarkets(settings.kalshi_api_key, {
      status: 'open',
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    pagesChecked++

    for (const m of result.markets) {
      if (!m.mve_selected_legs && !String(m.ticker ?? '').includes('KXMVE')) {
        found.push(m)
        if (found.length >= 3) break
      }
    }

    cursor = result.cursor
    if (!cursor) break
  }

  return NextResponse.json({ pages_checked: pagesChecked, count: found.length, markets: found })
}
