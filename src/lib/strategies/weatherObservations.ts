import { TEMP_TICKER_CITY_CODES } from '@/lib/signals'

const TIMEOUT_MS = 6000

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/geo+json' },
    })
    return res.ok ? res.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Today's local calendar date (YYYY-MM-DD) in the given IANA timezone, for
// the given instant. Used to filter NWS observations to "today, local to the
// station" — a UTC-day filter would wrongly include/exclude hours near
// midnight for any US city.
function localDateStr(tz: string, date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = fmt.formatToParts(date)
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const m = parts.find((p) => p.type === 'month')?.value ?? '00'
  const d = parts.find((p) => p.type === 'day')?.value ?? '00'
  return `${y}-${m}-${d}`
}

export interface TodayObservedExtreme {
  cityCode: string
  kind: 'H' | 'L'
  valueF: number
  asOfIso: string
}

// Today's observed high (max so far) or low (min so far) for a Kalshi
// TEMP_TICKER_CITY_CODES city, from live NWS station observations. Returns
// null on any failure or if there's no observation for today yet — never
// throws, and never guesses a value.
export async function getTodaysObservedExtreme(cityCode: string, kind: 'H' | 'L'): Promise<TodayObservedExtreme | null> {
  const city = TEMP_TICKER_CITY_CODES[cityCode]
  if (!city) return null

  try {
    const point = await fetchJson(`https://api.weather.gov/points/${city.lat},${city.lon}`)
    const stationsUrl: string | undefined = point?.properties?.observationStations
    if (!stationsUrl) return null

    const stations = await fetchJson(stationsUrl)
    const stationUrl: string | undefined = stations?.features?.[0]?.id
    if (!stationUrl) return null

    // 30h lookback comfortably covers "today so far" in any US timezone with
    // margin, without pulling NWS's full multi-day observation history.
    const startIso = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
    const obs = await fetchJson(`${stationUrl}/observations?start=${encodeURIComponent(startIso)}`)
    const features: any[] = obs?.features ?? []
    if (features.length === 0) return null

    const today = localDateStr(city.tz, new Date())
    let best: { valueF: number; asOfIso: string } | null = null

    for (const f of features) {
      const ts: string | undefined = f?.properties?.timestamp
      const celsius: number | null = f?.properties?.temperature?.value
      if (!ts || celsius == null || !Number.isFinite(celsius)) continue
      const obsDate = new Date(ts)
      if (!Number.isFinite(obsDate.getTime())) continue
      if (localDateStr(city.tz, obsDate) !== today) continue

      const valueF = (celsius * 9) / 5 + 32
      if (!best) {
        best = { valueF, asOfIso: ts }
      } else if (kind === 'H' ? valueF > best.valueF : valueF < best.valueF) {
        best = { valueF, asOfIso: ts }
      }
    }

    if (!best) return null
    return { cityCode, kind, valueF: best.valueF, asOfIso: best.asOfIso }
  } catch {
    return null
  }
}
