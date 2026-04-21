/**
 * Economic calendar: upcoming release dates + street consensus forecasts
 *
 * Primary:  Trading Economics guest API (free, no key required)
 *           Returns scheduled dates + consensus for major US indicators
 * Fallback: Hard-coded 2026 BLS/FOMC schedule (always works, no consensus)
 *
 * Provides Claude with:
 *   - Days until next release ("releases in 2 days")
 *   - Street consensus ("consensus: 2.6%")
 *   - Previous actual ("prev: 2.4%")
 * This is the key comparison that turns raw data into forecasting edge.
 */

import type { Signal } from './signals'

const TIMEOUT_MS = 6000

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    })
    return res.ok ? res.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Trading Economics guest API ──────────────────────────────────────────────

// Maps TE category names → internal type
const TE_CATEGORY: Record<string, CalendarCategory> = {
  'inflation rate': 'cpi',
  'core inflation rate': 'cpi',
  'cpi': 'cpi',
  'core cpi': 'cpi',
  'pce price index': 'pce',
  'core pce price index': 'pce',
  'personal consumption expenditure': 'pce',
  'non farm payrolls': 'jobs',
  'nonfarm payrolls': 'jobs',
  'unemployment rate': 'jobs',
  'initial jobless claims': 'jobs',
  'jobless claims': 'jobs',
  'fed interest rate decision': 'fed',
  'interest rate decision': 'fed',
  'fomc minutes': 'fed',
  'gdp growth rate': 'gdp',
  'gdp growth rate qoq': 'gdp',
  'gdp growth rate yoy': 'gdp',
  'gdp': 'gdp',
  'retail sales mom': 'retail',
  'retail sales yoy': 'retail',
  'retail sales': 'retail',
  'ism manufacturing pmi': 'ism',
  'ism services pmi': 'ism',
  'manufacturing pmi': 'ism',
  'services pmi': 'ism',
}

export type CalendarCategory = 'cpi' | 'pce' | 'jobs' | 'fed' | 'gdp' | 'retail' | 'ism'

export interface CalendarRelease {
  event: string
  category: CalendarCategory
  releaseDate: Date
  daysAway: number           // negative = already released
  consensus: string | null   // e.g. "2.6%"
  previous: string | null    // e.g. "2.4%"
  actual: string | null      // null if not yet released
}

function daysUntil(date: Date): number {
  const now = new Date()
  const diffMs = date.getTime() - now.setHours(0, 0, 0, 0)
  return Math.round(diffMs / 86_400_000)
}

function fmtVal(v: any, unit?: string): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!s || s === '0' && unit === '%') return null
  return unit === '%' ? `${s}%` : unit === 'K' ? `${s}K` : unit === 'B' ? `$${s}B` : s
}

async function fetchTECalendar(): Promise<CalendarRelease[]> {
  const data = await fetchJson(
    'https://api.tradingeconomics.com/calendar/country/united%20states?c=guest:guest'
  )
  if (!Array.isArray(data) || data.length === 0) return []

  const now = new Date()
  const results: CalendarRelease[] = []

  for (const ev of data) {
    const cat = TE_CATEGORY[String(ev.Category ?? '').toLowerCase().trim()]
    if (!cat) continue

    const releaseDate = new Date(ev.Date)
    if (isNaN(releaseDate.getTime())) continue

    const daysAway = daysUntil(releaseDate)
    if (daysAway < -7 || daysAway > 45) continue  // only ±window

    const unit = ev.Unit ?? ''
    results.push({
      event: ev.Category,
      category: cat,
      releaseDate,
      daysAway,
      consensus: fmtVal(ev.Forecast, unit),
      previous: fmtVal(ev.Previous, unit),
      actual: fmtVal(ev.Actual, unit),
    })
  }

  return results
}

// ── Hard-coded 2026 fallback schedule ────────────────────────────────────────
// Source: BLS News Release Schedule + FOMC Calendar (published in advance)
// No consensus forecasts — just dates, so Claude at least knows timing.

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day)
}

const HARDCODED_2026: Array<{ event: string; category: CalendarCategory; date: Date }> = [
  // BLS CPI (Consumer Price Index) — typically released mid-month
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 1, 14) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 2, 11) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 3, 11) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 4, 10) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 5, 13) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 6, 10) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 7, 15) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 8, 12) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 9, 9) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 10, 14) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 11, 12) },
  { event: 'CPI (Inflation Rate)', category: 'cpi', date: d(2026, 12, 9) },
  // BLS Jobs (Non-Farm Payrolls) — typically first Friday of each month
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 1, 9) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 2, 6) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 3, 6) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 4, 3) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 5, 8) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 6, 5) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 7, 2) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 8, 7) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 9, 4) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 10, 2) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 11, 6) },
  { event: 'Non Farm Payrolls', category: 'jobs', date: d(2026, 12, 4) },
  // FOMC meetings (decision day = second day)
  // Source: Federal Reserve 2026 FOMC calendar
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 1, 28) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 3, 18) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 4, 29) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 6, 17) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 7, 29) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 9, 16) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 10, 28) },
  { event: 'Fed Interest Rate Decision', category: 'fed', date: d(2026, 12, 9) },
  // GDP Advance Estimate (BEA) — last week of month following quarter-end
  { event: 'GDP Growth Rate', category: 'gdp', date: d(2026, 1, 29) },
  { event: 'GDP Growth Rate', category: 'gdp', date: d(2026, 4, 29) },
  { event: 'GDP Growth Rate', category: 'gdp', date: d(2026, 7, 29) },
  { event: 'GDP Growth Rate', category: 'gdp', date: d(2026, 10, 28) },
]

function fallbackReleases(categories: CalendarCategory[]): CalendarRelease[] {
  const catSet = new Set(categories)
  return HARDCODED_2026
    .filter(r => catSet.has(r.category))
    .map(r => ({
      event: r.event,
      category: r.category,
      releaseDate: r.date,
      daysAway: daysUntil(r.date),
      consensus: null,
      previous: null,
      actual: null,
    }))
    .filter(r => r.daysAway >= -7 && r.daysAway <= 45)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch upcoming economic releases for the given categories as Signal objects.
 * Returns the single nearest upcoming event per category (plus any same-day events).
 * Never throws.
 */
export async function getCalendarSignals(categories: CalendarCategory[]): Promise<Signal[]> {
  let releases: CalendarRelease[] = []

  try {
    releases = await fetchTECalendar()
  } catch {
    // fall through to fallback
  }

  // If TE returned nothing useful, use hard-coded schedule
  const catSet = new Set(categories)
  const filtered = releases.filter(r => catSet.has(r.category))
  if (filtered.length === 0) {
    releases = fallbackReleases(categories)
  } else {
    releases = filtered
  }

  // For each category, keep only the nearest upcoming event
  // (or most recent if nothing upcoming in the next 45d)
  const byCategory = new Map<CalendarCategory, CalendarRelease>()
  for (const r of releases.sort((a, b) => a.daysAway - b.daysAway)) {
    if (!byCategory.has(r.category)) {
      byCategory.set(r.category, r)
    }
  }

  return Array.from(byCategory.values()).map(r => releaseToSignal(r))
}

function releaseToSignal(r: CalendarRelease): Signal {
  const dateFmt = r.releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  let timingNote: string
  if (r.actual) {
    timingNote = r.daysAway < 0
      ? `released ${Math.abs(r.daysAway)}d ago`
      : 'released today'
  } else if (r.daysAway === 0) {
    timingNote = 'RELEASES TODAY'
  } else if (r.daysAway === 1) {
    timingNote = 'releases tomorrow'
  } else if (r.daysAway > 0) {
    timingNote = `releases ${dateFmt} (${r.daysAway}d away)`
  } else {
    timingNote = `released ${dateFmt}`
  }

  const parts: string[] = [timingNote]
  if (r.actual) parts.push(`actual: ${r.actual}`)
  else if (r.consensus) parts.push(`consensus: ${r.consensus}`)
  else parts.push('consensus: TBD')
  if (r.previous) parts.push(`prev: ${r.previous}`)

  return {
    label: `Next: ${r.event}`,
    value: r.actual ?? r.consensus ?? dateFmt,
    note: parts.join(' · '),
    source: r.consensus ? 'Trading Economics' : 'BLS/FOMC schedule',
  }
}
