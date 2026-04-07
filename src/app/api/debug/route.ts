import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/storage'
import { fetchMarkets } from '@/lib/kalshi'

export async function GET() {
  const settings = getSettings()
  if (!settings.kalshi_api_key) {
    return NextResponse.json({ error: 'No API key' }, { status: 400 })
  }

  const { markets } = await fetchMarkets(settings.kalshi_api_key, {
    status: 'open',
    limit: 3,
  })

  // Return raw market objects so we can see all field names
  return NextResponse.json({ count: markets.length, markets })
}
