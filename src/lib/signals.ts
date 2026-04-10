/**
 * Real-time market signal fetcher
 *
 * Maps Kalshi series tickers to live data from free public APIs:
 * - Yahoo Finance (no key): equity indices, VIX, crypto, Fed Funds futures
 * - BLS v1 API (no key): CPI, core CPI
 * - Economic calendar: upcoming release dates + street consensus forecasts
 *
 * All fetches have a 5s timeout and fail silently — a missing signal
 * never blocks an analysis or scan.
 */

import { getCalendarSignals } from './calendar'

export interface Signal {
  label: string    // e.g. "VIX (fear index)"
  value: string    // e.g. "22.4"
  note: string     // e.g. "elevated — implies ~1.4% daily S&P move"
  source: string   // e.g. "CBOE via Yahoo Finance"
}

// ── helpers ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 5000

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function yahooPrice(symbol: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
  const data = await fetchJson(url)
  const closes: number[] | undefined =
    data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
  if (!closes) return null
  return closes.filter(Boolean).at(-1) ?? null
}

async function yahooOHLC(symbol: string, range = '30d'): Promise<{ closes: number[]; dates: string[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
  const data = await fetchJson(url)
  const result = data?.chart?.result?.[0]
  if (!result) return null
  const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(Boolean)
  const timestamps: number[] = result.timestamp ?? []
  const dates = timestamps.map((t: number) => new Date(t * 1000).toISOString().slice(0, 10))
  return { closes, dates }
}

function pctChange(prev: number, curr: number) {
  return (((curr - prev) / prev) * 100).toFixed(1)
}

function annualizedVol(closes: number[]): number {
  if (closes.length < 5) return 0
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]))
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance * 252) * 100
}

// ── per-category signal fetchers ────────────────────────────────────────────

async function spxSignals(marketTicker?: string): Promise<Signal[]> {
  const signals: Signal[] = []
  const [spx, vix] = await Promise.all([
    yahooOHLC('%5EGSPC', '10d'),
    yahooPrice('%5EVIX'),
  ])

  if (spx && spx.closes.length >= 2) {
    const curr = spx.closes.at(-1)!
    const prev = spx.closes.at(-2)!
    const chg = pctChange(prev, curr)
    const vol = annualizedVol(spx.closes)
    signals.push({
      label: 'S&P 500',
      value: curr.toFixed(0),
      note: `${Number(chg) >= 0 ? '+' : ''}${chg}% yesterday · annualized vol ${vol.toFixed(0)}%`,
      source: 'Yahoo Finance',
    })

    // Try to extract the range bounds from the ticker e.g. INXW-25APR21-B5000T5100
    if (marketTicker) {
      const bounds = marketTicker.match(/B(\d+)T(\d+)/)
      if (bounds) {
        const lower = parseInt(bounds[1])
        const upper = parseInt(bounds[2])
        const pctToLower = pctChange(curr, lower)
        const pctToUpper = pctChange(curr, upper)
        signals.push({
          label: 'Distance to range bounds',
          value: `[${lower.toLocaleString()} – ${upper.toLocaleString()}]`,
          note: `current ${curr.toFixed(0)} is ${Math.abs(Number(pctToLower)).toFixed(1)}% from lower, ${Math.abs(Number(pctToUpper)).toFixed(1)}% from upper`,
          source: 'derived from ticker + Yahoo Finance',
        })
      }
    }
  }

  if (vix) {
    const level = vix < 15 ? 'low — calm market' : vix < 20 ? 'moderate' : vix < 30 ? 'elevated — market stressed' : 'very high — crisis levels'
    signals.push({
      label: 'VIX (volatility index)',
      value: vix.toFixed(1),
      note: level,
      source: 'CBOE via Yahoo Finance',
    })
  }

  return signals
}

async function nasdaqSignals(marketTicker?: string): Promise<Signal[]> {
  const signals: Signal[] = []
  const data = await yahooOHLC('%5EIXIC', '10d')
  if (data && data.closes.length >= 2) {
    const curr = data.closes.at(-1)!
    const prev = data.closes.at(-2)!
    const chg = pctChange(prev, curr)
    signals.push({
      label: 'Nasdaq Composite',
      value: curr.toFixed(0),
      note: `${Number(chg) >= 0 ? '+' : ''}${chg}% yesterday`,
      source: 'Yahoo Finance',
    })
    if (marketTicker) {
      const bounds = marketTicker.match(/B(\d+)T(\d+)/)
      if (bounds) {
        const lower = parseInt(bounds[1])
        const upper = parseInt(bounds[2])
        signals.push({
          label: 'Distance to range bounds',
          value: `[${lower.toLocaleString()} – ${upper.toLocaleString()}]`,
          note: `current ${curr.toFixed(0)}: ${Math.abs(Number(pctChange(curr, lower))).toFixed(1)}% from lower, ${Math.abs(Number(pctChange(curr, upper))).toFixed(1)}% from upper`,
          source: 'derived from ticker + Yahoo Finance',
        })
      }
    }
  }
  return signals
}

async function treasurySignals(): Promise<Signal[]> {
  const signals: Signal[] = []
  // ^TNX = 10-year yield, ^FVX = 5-year yield, ^IRX = 13-week T-bill
  const [t10, t5, t3m] = await Promise.all([
    yahooPrice('%5ETNX'),
    yahooPrice('%5EFVX'),
    yahooPrice('%5EIRX'),
  ])
  if (t10 && t3m) {
    const spread = (t10 - t3m).toFixed(2)
    const inverted = t3m > t10
    signals.push({
      label: '10yr Treasury yield',
      value: `${t10.toFixed(2)}%`,
      note: `3m/10yr spread: ${Number(spread) >= 0 ? '+' : ''}${spread}% (${inverted ? 'INVERTED — recession signal' : 'normal curve'})`,
      source: 'Yahoo Finance (^TNX / ^IRX)',
    })
  } else if (t10) {
    signals.push({ label: '10yr Treasury yield', value: `${t10.toFixed(2)}%`, note: '', source: 'Yahoo Finance (^TNX)' })
  }
  if (t5) {
    signals.push({ label: '5yr Treasury yield', value: `${t5.toFixed(2)}%`, note: '', source: 'Yahoo Finance (^FVX)' })
  }
  return signals
}

async function fedSignals(): Promise<Signal[]> {
  const signals: Signal[] = []
  // Fed Funds futures: price = 100 - expected average fed funds rate
  // ZQ=F is the front-month 30-day Fed Funds futures
  const [ff1, ff2, ff3] = await Promise.all([
    yahooPrice('ZQ%3DF'),   // front month
    yahooPrice('ZQM25.CBT'), // fallback symbols
    yahooPrice('ZQN25.CBT'),
  ])

  const futuresPrice = ff1 ?? ff2 ?? ff3
  if (futuresPrice) {
    const impliedRate = (100 - futuresPrice).toFixed(2)
    signals.push({
      label: 'Fed Funds futures implied rate',
      value: `${impliedRate}%`,
      note: 'Front-month 30-day futures price = 100 − implied average rate for delivery month',
      source: 'CME via Yahoo Finance (ZQ=F)',
    })
  }

  // Also fetch current SOFR as proxy for effective fed funds
  const sofr = await yahooPrice('%5ESOFR')
  if (sofr) {
    signals.push({
      label: 'SOFR (overnight rate proxy)',
      value: `${sofr.toFixed(2)}%`,
      note: 'Tracks effective Fed Funds rate closely',
      source: 'Yahoo Finance',
    })
  }

  return signals
}

/**
 * CME FedWatch probability — derives market-implied P(cut) from Fed Funds futures
 * using the same weighted-average methodology CME publishes on FedWatch Tool.
 *
 * Formula: implied_month_avg = (currentRate × days_before + newRate × days_after) / totalDays
 * Solve for newRate, then P(cut) = (currentRate − newRate) / 0.25
 */
async function fedWatchSignal(): Promise<Signal[]> {
  // 2026 FOMC decision dates (last day of each 2-day meeting)
  const FOMC_DATES = [
    '2026-01-29', '2026-03-19', '2026-04-30',
    '2026-06-18', '2026-07-30', '2026-09-17',
    '2026-10-29', '2026-12-10',
  ]

  // Month-code mapping for CME futures tickers (Jan=F ... Dec=Z)
  const MONTH_CODES = 'FGHJKMNQUVXZ'

  const today = new Date()
  const upcomingMeetings = FOMC_DATES
    .map((d) => new Date(d))
    .filter((d) => d >= today)
    .sort((a, b) => a.getTime() - b.getTime())

  if (upcomingMeetings.length === 0) return []

  const nextMeeting = upcomingMeetings[0]
  const meetingMonth = nextMeeting.getMonth()   // 0-indexed
  const meetingYear = nextMeeting.getFullYear()
  const meetingDay = nextMeeting.getDate()
  const daysInMeetingMonth = new Date(meetingYear, meetingMonth + 1, 0).getDate()
  const daysAfterMeeting = daysInMeetingMonth - meetingDay

  // If the meeting falls in the last week of the month (little post-meeting time),
  // use next month's futures for a cleaner signal
  let targetMonth = meetingMonth
  let targetYear = meetingYear
  if (daysAfterMeeting < 7) {
    targetMonth = (meetingMonth + 1) % 12
    if (targetMonth === 0) targetYear++
  }

  const monthCode = MONTH_CODES[targetMonth]
  const yearCode = String(targetYear).slice(-2)
  const futuresTicker = `ZQ${monthCode}${yearCode}.CBT`

  const [futuresPrice, sofr] = await Promise.all([
    yahooPrice(futuresTicker),
    yahooPrice('%5ESOFR'),
  ])

  if (!futuresPrice || !sofr) return []

  const currentRate = sofr
  const impliedMonthAvg = 100 - futuresPrice

  let pCut: number

  if (targetMonth === meetingMonth) {
    // Delivery month contains the meeting — apply CME weighted formula
    const totalDays = daysInMeetingMonth
    const daysBefore = meetingDay
    const daysAfter = totalDays - daysBefore
    if (daysAfter <= 0) {
      pCut = 0
    } else {
      // Solve: impliedMonthAvg = (currentRate * daysBefore + newRate * daysAfter) / totalDays
      const newRate = (impliedMonthAvg * totalDays - currentRate * daysBefore) / daysAfter
      pCut = (currentRate - newRate) / 0.25
    }
  } else {
    // Whole delivery month is post-meeting — simple difference
    pCut = (currentRate - impliedMonthAvg) / 0.25
  }

  pCut = Math.max(0, Math.min(1, pCut))

  const meetingStr = nextMeeting.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return [{
    label: 'CME FedWatch P(≥25bps cut)',
    value: `${(pCut * 100).toFixed(0)}%`,
    note: `${meetingStr} FOMC · implied rate ${impliedMonthAvg.toFixed(2)}% vs current ${currentRate.toFixed(2)}% · futures: ${futuresTicker}`,
    source: 'CME Fed Funds futures via Yahoo Finance',
  }]
}

async function cpiSignals(): Promise<Signal[]> {
  const signals: Signal[] = []
  // BLS v1 API — no key required, 10 req/day limit
  // CUUR0000SA0 = All Urban Consumers, All Items (headline CPI)
  // CUUR0000SA0L1E = All Urban Consumers, All Items Less Food & Energy (core CPI)
  const [headline, core] = await Promise.all([
    fetchJson('https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0'),
    fetchJson('https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0L1E'),
  ])

  const parseCPI = (data: any) => {
    const series = data?.Results?.series?.[0]?.data
    if (!series || series.length < 13) return null
    const latest = series[0]
    const prevMonth = series[1]
    const prevYear = series[12]
    const yoy = (((latest.value - prevYear.value) / prevYear.value) * 100).toFixed(1)
    const mom = (((latest.value - prevMonth.value) / prevMonth.value) * 100).toFixed(2)

    // Historical base rates: compute YoY for each of the last 12 months (need 24 data points)
    let baseRateNote = ''
    if (series.length >= 24) {
      const yoyHistory: number[] = []
      for (let i = 0; i < 12; i++) {
        if (series[i + 12]) {
          yoyHistory.push(((series[i].value - series[i + 12].value) / series[i + 12].value) * 100)
        }
      }
      if (yoyHistory.length >= 3) {
        const above3 = yoyHistory.filter((v) => v > 3).length
        const above2 = yoyHistory.filter((v) => v > 2).length
        // 3-month trend using last 3 values (most recent first)
        const t = yoyHistory.slice(0, 3)
        const trend = t[0] > t[2] + 0.1 ? 'rising' : t[0] < t[2] - 0.1 ? 'falling' : 'flat'
        baseRateNote = ` · past 12mo: above 3% in ${above3}/12, above 2% in ${above2}/12, trend: ${trend}`
      }
    }

    return { month: `${latest.periodName} ${latest.year}`, yoy, mom, baseRateNote }
  }

  const h = parseCPI(headline)
  if (h) {
    signals.push({
      label: 'Headline CPI (YoY)',
      value: `${h.yoy}%`,
      note: `${h.month} · MoM: ${Number(h.mom) >= 0 ? '+' : ''}${h.mom}%${h.baseRateNote}`,
      source: 'BLS (CUUR0000SA0)',
    })
  }

  const c = parseCPI(core)
  if (c) {
    signals.push({
      label: 'Core CPI (YoY, ex food & energy)',
      value: `${c.yoy}%`,
      note: `${c.month} · MoM: ${Number(c.mom) >= 0 ? '+' : ''}${c.mom}%${c.baseRateNote}`,
      source: 'BLS (CUUR0000SA0L1E)',
    })
  }

  return signals
}

async function jobsSignals(): Promise<Signal[]> {
  const signals: Signal[] = []
  // CES0000000001 = Total nonfarm payrolls
  // LNS14000000 = Unemployment rate
  const [payrolls, unrate] = await Promise.all([
    fetchJson('https://api.bls.gov/publicAPI/v1/timeseries/data/CES0000000001'),
    fetchJson('https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000'),
  ])

  const payrollData: any[] = payrolls?.Results?.series?.[0]?.data ?? []
  if (payrollData.length >= 2) {
    const latest = payrollData[0]
    const prev = payrollData[1]
    const added = Math.round((latest.value - prev.value) * 1000)
    const sign = added >= 0 ? '+' : ''

    // Historical base rates: monthly gains for last 12 months
    let baseRateNote = ''
    if (payrollData.length >= 13) {
      const monthlyGains: number[] = []
      for (let i = 0; i < 12; i++) {
        if (payrollData[i + 1]) {
          monthlyGains.push(Math.round((payrollData[i].value - payrollData[i + 1].value) * 1000))
        }
      }
      if (monthlyGains.length >= 3) {
        const above150k = monthlyGains.filter((v) => v > 150000).length
        const above200k = monthlyGains.filter((v) => v > 200000).length
        const avg = Math.round(monthlyGains.reduce((a, b) => a + b, 0) / monthlyGains.length)
        // Trend: compare first 3 months to last 3 months
        const recent3 = monthlyGains.slice(0, 3).reduce((a, b) => a + b, 0) / 3
        const older3 = monthlyGains.slice(9, 12).reduce((a, b) => a + b, 0) / 3
        const trend = recent3 > older3 + 20000 ? 'accelerating' : recent3 < older3 - 20000 ? 'decelerating' : 'stable'
        baseRateNote = ` · past 12mo avg: ${(avg / 1000).toFixed(0)}k/mo, above 150k: ${above150k}/12, above 200k: ${above200k}/12, trend: ${trend}`
      }
    }

    signals.push({
      label: 'Nonfarm payrolls',
      value: `${sign}${(added / 1000).toFixed(0)}k jobs`,
      note: `${latest.periodName} ${latest.year}${baseRateNote}`,
      source: 'BLS (CES0000000001)',
    })
  }

  const latestUnrate = unrate?.Results?.series?.[0]?.data?.[0]
  if (latestUnrate) {
    signals.push({
      label: 'Unemployment rate',
      value: `${latestUnrate.value}%`,
      note: `${latestUnrate.periodName} ${latestUnrate.year}`,
      source: 'BLS (LNS14000000)',
    })
  }

  return signals
}

async function gdpNowSignal(): Promise<Signal[]> {
  // Atlanta Fed GDPNow CSV
  const csv = await fetch(
    'https://www.atlantafed.org/-/media/documents/cqer/researchcq/gdpnow/RealGDPTrackingData.xlsx',
    { signal: AbortSignal.timeout(TIMEOUT_MS) }
  ).catch(() => null)
  // CSV is binary XLSX so fall back to a simpler approach
  // Try the public tracking page text version
  const data = await fetchJson(
    'https://www.atlantafed.org/cqer/research/gdpnow.aspx'
  )
  // If the above fails, we skip — GDPNow is hard to scrape server-side
  // Return empty and rely on Claude's training data for GDP
  return []
}

async function cryptoSignals(symbol: string): Promise<Signal[]> {
  const signals: Signal[] = []
  const data = await yahooOHLC(symbol, '30d')
  if (!data || data.closes.length < 2) return signals

  const curr = data.closes.at(-1)!
  const prev7 = data.closes.at(-8)
  const prev30 = data.closes[0]
  const vol = annualizedVol(data.closes)

  const assetName = symbol.replace('-USD', '').replace('%5E', '')
  signals.push({
    label: `${assetName} price`,
    value: `$${curr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    note: [
      prev7 ? `7d: ${Number(pctChange(prev7, curr)) >= 0 ? '+' : ''}${pctChange(prev7, curr)}%` : '',
      prev30 ? `30d: ${Number(pctChange(prev30, curr)) >= 0 ? '+' : ''}${pctChange(prev30, curr)}%` : '',
      `annualized vol: ${vol.toFixed(0)}%`,
    ].filter(Boolean).join(' · '),
    source: 'Yahoo Finance',
  })

  return signals
}

async function dxySignal(): Promise<Signal[]> {
  const data = await yahooOHLC('DX-Y.NYB', '10d') // US Dollar Index
  if (!data || data.closes.length < 2) return []
  const curr = data.closes.at(-1)!
  const prev = data.closes.at(-2)!
  return [{
    label: 'US Dollar Index (DXY)',
    value: curr.toFixed(2),
    note: `${Number(pctChange(prev, curr)) >= 0 ? '+' : ''}${pctChange(prev, curr)}% yesterday · strength = tariff pressure on trading partners`,
    source: 'ICE via Yahoo Finance (DX-Y.NYB)',
  }]
}

async function oilSignals(): Promise<Signal[]> {
  const signals: Signal[] = []
  const data = await yahooOHLC('CL%3DF', '10d') // WTI crude futures
  if (data && data.closes.length >= 2) {
    const curr = data.closes.at(-1)!
    const prev = data.closes.at(-2)!
    signals.push({
      label: 'WTI Crude Oil',
      value: `$${curr.toFixed(2)}/bbl`,
      note: `${Number(pctChange(prev, curr)) >= 0 ? '+' : ''}${pctChange(prev, curr)}% yesterday`,
      source: 'CME via Yahoo Finance (CL=F)',
    })
  }
  return signals
}

// ── series ticker → signal fetcher mapping ──────────────────────────────────

const FED_SERIES = new Set([
  'KXFEDDECISION', 'KXRATECUT', 'KXRATECUTCOUNT', 'KXFEDRATEMIN',
  'KXFRM', 'KXECB', 'KXBOE',
])
const CPI_SERIES = new Set(['KXCPI', 'KXPCECORE', 'KXISMSERVICES', 'KXUSRETAIL'])
const JOBS_SERIES = new Set(['KXJOBLESS'])
const SPX_SERIES = new Set(['INXU', 'INXW', 'INXD'])
const NASDAQ_SERIES = new Set(['NASDAQ100'])
const BTC_SERIES = new Set(['KXBTC'])
const ETH_SERIES = new Set(['KXETH'])
const SOL_SERIES = new Set(['KXSOL', 'KXSOLE'])
const OIL_SERIES = new Set(['OILW', 'KXNATGASMON'])

/** Extract the series ticker prefix from a full market ticker */
export function seriesFromTicker(ticker: string): string {
  // e.g. KXCPI-25APR-T3.5 → KXCPI
  //      INXW-25APR21-B5000T5100 → INXW
  const parts = ticker.split('-')
  return parts[0]
}

/**
 * Fetch all relevant real-time signals for a given market.
 * Never throws — returns [] on any failure.
 */
export async function getSignalsForMarket(
  ticker: string,
  seriesTicker?: string,
): Promise<Signal[]> {
  const series = seriesTicker ?? seriesFromTicker(ticker)

  try {
    if (FED_SERIES.has(series)) {
      const [fed, fw, tsys, cal] = await Promise.all([fedSignals(), fedWatchSignal(), treasurySignals(), getCalendarSignals(['fed'])])
      return [...fed, ...fw, ...tsys, ...cal]
    }
    if (CPI_SERIES.has(series)) {
      const [cpi, fed, fw, tsys, cal] = await Promise.all([cpiSignals(), fedSignals(), fedWatchSignal(), treasurySignals(), getCalendarSignals(['cpi', 'pce'])])
      return [...cpi, ...fed, ...fw, ...tsys, ...cal]
    }
    if (JOBS_SERIES.has(series)) {
      const [jobs, tsys, cal] = await Promise.all([jobsSignals(), treasurySignals(), getCalendarSignals(['jobs'])])
      return [...jobs, ...tsys, ...cal]
    }
    if (SPX_SERIES.has(series)) return await spxSignals(ticker)
    if (NASDAQ_SERIES.has(series)) return await nasdaqSignals(ticker)
    if (BTC_SERIES.has(series)) return await cryptoSignals('BTC-USD')
    if (ETH_SERIES.has(series)) return await cryptoSignals('ETH-USD')
    if (SOL_SERIES.has(series)) return await cryptoSignals('SOL-USD')
    if (OIL_SERIES.has(series)) return await oilSignals()
    // GDP: full macro picture + calendar
    if (series === 'KXGDP' || series === 'GDP') {
      const [cpi, jobs, tsys, cal] = await Promise.all([cpiSignals(), jobsSignals(), treasurySignals(), getCalendarSignals(['gdp', 'cpi', 'jobs'])])
      return [...cpi, ...jobs, ...tsys, ...cal]
    }
    // Tariff/political: equities + dollar index
    if (series.includes('TARIFF') || series === 'KXNEWTARIFFS') {
      const [spx, dxy] = await Promise.all([spxSignals(), dxySignal()])
      return [...spx, ...dxy]
    }
  } catch {
    // signals are best-effort
  }
  return []
}

/** Fetch signals for a batch of markets in parallel (one per unique series) */
export async function getSignalsForMarkets(
  markets: Array<{ id?: string; title: string }>
): Promise<Map<string, Signal[]>> {
  const seriesMap = new Map<string, string[]>() // series → list of tickers
  for (const m of markets) {
    const ticker = m.id ?? ''
    const series = seriesFromTicker(ticker)
    if (!seriesMap.has(series)) seriesMap.set(series, [])
    seriesMap.get(series)!.push(ticker)
  }

  const results = new Map<string, Signal[]>()
  await Promise.all(
    Array.from(seriesMap.entries()).map(async ([series, tickers]) => {
      const signals = await getSignalsForMarket(tickers[0], series)
      for (const ticker of tickers) {
        results.set(ticker, signals)
      }
    })
  )
  return results
}

/** Format signals as a compact string block for Claude prompts */
export function formatSignals(signals: Signal[]): string {
  if (signals.length === 0) return ''
  const lines = signals.map(
    (s) => `  • ${s.label}: ${s.value} — ${s.note} [${s.source}]`
  )
  return `Live market signals:\n${lines.join('\n')}`
}
