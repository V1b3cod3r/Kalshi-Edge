import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/storage'
import { getSignalsForMarket } from '@/lib/signals'

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

async function kalshiGet(apiKey: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${KALSHI_BASE_URL}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') ?? 'series'

  // Signals test doesn't require Kalshi API key
  if (mode === 'signals') {
    const ticker = url.searchParams.get('ticker') ?? 'KXCPI-25APR-T3'
    const series = url.searchParams.get('series') ?? ticker.split('-')[0]
    const signals = await getSignalsForMarket(ticker, series)
    return NextResponse.json({ ticker, series, signals, count: signals.length })
  }

  const settings = getSettings()
  if (!settings.kalshi_api_key) {
    return NextResponse.json({ error: 'No API key' }, { status: 400 })
  }

  try {
    if (mode === 'auth') {
      // Test if the API key can access authenticated portfolio endpoints
      const data = await kalshiGet(settings.kalshi_api_key, '/portfolio/balance')
      return NextResponse.json({ ok: true, balance: data })
    }

    if (mode === 'series') {
      const data = await kalshiGet(settings.kalshi_api_key, '/series', { limit: '20' })
      const tickers = (data.series ?? []).map((s: any) => `${s.ticker} | ${s.category} | ${s.title}`)
      return new Response(tickers.join('\n'), { headers: { 'Content-Type': 'text/plain' } })
    }

    if (mode === 'events') {
      const data = await kalshiGet(settings.kalshi_api_key, '/events', { limit: '20' })
      return NextResponse.json(data)
    }

    if (mode === 'sample') {
      const data = await kalshiGet(settings.kalshi_api_key, '/markets', { limit: '5' })
      const summary = (data.markets ?? []).map((m: any) => ({
        ticker: m.ticker, status: m.status, is_mve: !!m.mve_selected_legs,
        yes_ask_dollars: m.yes_ask_dollars, volume_24h_fp: m.volume_24h_fp,
        title: m.title?.slice(0, 60),
      }))
      return NextResponse.json({ cursor: data.cursor, summary })
    }

    if (mode === 'key') {
      // Diagnostic: show info about the stored private key without revealing it
      const raw = settings.kalshi_private_key ?? ''
      if (!raw) return NextResponse.json({ error: 'No private key stored' })

      const hasPemHeader = raw.includes('-----BEGIN')
      const hasPemFooter = raw.includes('-----END')
      const literalBackslashN = (raw.match(/\\n/g) ?? []).length
      const actualNewlines = (raw.match(/\n/g) ?? []).length
      const carriageReturns = (raw.match(/\r/g) ?? []).length
      const length = raw.length
      const first40 = raw.slice(0, 40).replace(/\n/g, '↵').replace(/\r/g, '↩')
      const last40 = raw.slice(-40).replace(/\n/g, '↵').replace(/\r/g, '↩')

      // Try to parse the key and report the result
      let parseResult = 'not attempted'
      try {
        const { createPrivateKey } = await import('crypto')
        let normalized = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
        createPrivateKey(normalized)
        parseResult = 'SUCCESS'
      } catch (e: any) {
        parseResult = `FAIL: ${e.message}`
      }

      return NextResponse.json({
        length, hasPemHeader, hasPemFooter,
        literalBackslashN, actualNewlines, carriageReturns,
        first40, last40, parseResult,
      })
    }

    return NextResponse.json({ modes: ['series', 'events', 'sample', 'key'] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message })
  }
}
