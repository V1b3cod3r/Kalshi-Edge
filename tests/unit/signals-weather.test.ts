import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for a real production bug: markets with ticker prefix
// KXTEMPNYCH / KXTEMPLAXH got ZERO weather signal data because isWeatherTitle
// only matched the whole word "temperature", never "temp" (Kalshi's common
// abbreviation) — Claude was left estimating with no forecast data at all,
// producing wild disagreements (10-35% vs a market pricing 92-97%).

const NWS_POINTS_RESPONSE = {
  properties: { forecast: 'https://api.weather.gov/gridpoints/OKX/33,35/forecast' },
}
const NWS_FORECAST_RESPONSE = {
  properties: {
    periods: [
      { isDaytime: true, temperature: 78, name: 'Today', probabilityOfPrecipitation: { value: 10 } },
      { isDaytime: false, temperature: 62, name: 'Tonight', probabilityOfPrecipitation: { value: 5 } },
    ],
  },
}

function mockNwsFetch() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/points/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(NWS_POINTS_RESPONSE) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(NWS_FORECAST_RESPONSE) })
  }))
}

describe('isWeatherTitle (via getSignalsForMarket routing)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockNwsFetch()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('matches a title using "temp" (Kalshi\'s common abbreviation), not just "temperature"', async () => {
    const { getSignalsForMarket } = await import('@/lib/signals')
    // Series doesn't match the KXTEMP ticker-prefix path, forcing the
    // title-word fallback to be what decides this.
    const signals = await getSignalsForMarket('KXOTHER-26JUL12-T1', 'KXOTHER', 'NYC high temp above 75F?')
    const wx = signals.find((s) => s.label === 'NWS Weather Forecast')
    expect(wx).toBeDefined()
  })
})

describe('nwsWeatherSignal ticker-code city extraction', () => {
  beforeEach(() => {
    vi.resetModules()
    mockNwsFetch()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('derives New York from a KXTEMPNYCH ticker with NO title text at all', async () => {
    // This is the exact bug: the Analyze routes never passed marketTitle, so
    // the old title-only matching had nothing to work with. Ticker-based
    // extraction must work standalone.
    const { nwsWeatherSignal } = await import('@/lib/signals')
    const result = await nwsWeatherSignal(undefined, 'KXTEMPNYCH-26JUL1207-T74.99')
    expect(result).toContain('New York')
  })

  it('derives Los Angeles from a KXTEMPLAXH ticker', async () => {
    const { nwsWeatherSignal } = await import('@/lib/signals')
    const result = await nwsWeatherSignal(undefined, 'KXTEMPLAXH-26JUL1207-T68.99')
    expect(result).toContain('Los Angeles')
  })

  it('falls back to title-text matching when the ticker has no known city code', async () => {
    const { nwsWeatherSignal } = await import('@/lib/signals')
    const result = await nwsWeatherSignal('Chicago high temp today', 'KXUNKNOWN-26JUL12-T1')
    expect(result).toContain('Chicago')
  })

  it('returns empty when neither ticker nor title identifies a known city (never guesses)', async () => {
    const { nwsWeatherSignal } = await import('@/lib/signals')
    const result = await nwsWeatherSignal('Some unrelated market', 'KXUNKNOWN-26JUL12-T1')
    expect(result).toBe('')
  })

  it('routes via ticker prefix even when getSignalsForMarket is called with no title (the Analyze-route gap)', async () => {
    const { getSignalsForMarket } = await import('@/lib/signals')
    const signals = await getSignalsForMarket('KXTEMPNYCH-26JUL1207-T74.99', 'KXTEMPNYCH', undefined)
    const wx = signals.find((s) => s.label === 'NWS Weather Forecast')
    expect(wx).toBeDefined()
    expect(wx?.note).toContain('New York')
  })
})
