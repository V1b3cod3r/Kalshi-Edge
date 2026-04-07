import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/storage'
import { fetchMarkets } from '@/lib/kalshi'

export async function GET(req: Request) {
  const settings = getSettings()
  if (!settings.kalshi_api_key) {
    return NextResponse.json({ error: 'No API key' }, { status: 400 })
  }

  // ?sample=1 — return raw first page unfiltered to inspect field names and statuses
  const url = new URL(req.url)
  if (url.searchParams.get('sample') === '1') {
    const result = await fetchMarkets(settings.kalshi_api_key, { limit: 5 })
    const summary = result.markets.map((m: any) => ({
      ticker: m.ticker,
      status: m.status,
      is_mve: !!m.mve_selected_legs,
      yes_ask_dollars: m.yes_ask_dollars,
      yes_bid_dollars: m.yes_bid_dollars,
      volume_24h_fp: m.volume_24h_fp,
      volume_fp: m.volume_fp,
      title: m.title?.slice(0, 60),
    }))
    return NextResponse.json({ total: result.markets.length, summary })
  }

  // Page through until we find 3 non-MVE markets
  const found: any[] = []
  let cursor: string | null = null
  let pagesChecked = 0

  while (found.length < 3 && pagesChecked < 10) {
    const result = await fetchMarkets(settings.kalshi_api_key, {
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

  return NextResponse.json({
    pages_checked: pagesChecked,
    non_mve_found: found.length,
    note: found.length === 0 ? 'ALL markets were MVE parlays — try /api/debug?sample=1 to see raw first page' : undefined,
    markets: found,
  })
}
