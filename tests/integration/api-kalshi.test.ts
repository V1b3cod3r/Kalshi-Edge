import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  vi.unstubAllGlobals()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/kalshi/markets')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString())
}

describe('GET /api/kalshi/markets', () => {
  it('returns 400 when kalshi_api_key is not configured', async () => {
    const { GET } = await import('@/app/api/kalshi/markets/route')

    const req = makeGetRequest()
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Kalshi')
  })

  it('fetches markets when API key is configured', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    saveSettings(settings)

    const mockMarkets = [
      { ticker: 'TEST-1', title: 'Test market', yes_ask: 45, yes_bid: 43 },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markets: mockMarkets, cursor: null }),
      text: () => Promise.resolve(''),
    }))

    vi.resetModules()
    const { GET } = await import('@/app/api/kalshi/markets/route')

    const req = makeGetRequest({ limit: '10' })
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.markets).toEqual(mockMarkets)
  })

  it('passes query params to Kalshi API', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-test-key'
    saveSettings(settings)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markets: [], cursor: null }),
      text: () => Promise.resolve(''),
    }))

    vi.resetModules()
    const { GET } = await import('@/app/api/kalshi/markets/route')

    const req = makeGetRequest({ search: 'inflation', category: 'Economics', limit: '25' })
    await GET(req)

    const calledUrl = (fetch as any).mock.calls[0][0]
    expect(calledUrl).toContain('search=inflation')
    expect(calledUrl).toContain('category=Economics')
    expect(calledUrl).toContain('limit=25')
  })

  it('returns 500 when Kalshi API call fails', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.kalshi_api_key = 'kx-bad-key'
    saveSettings(settings)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Unauthorized'),
    }))

    vi.resetModules()
    const { GET } = await import('@/app/api/kalshi/markets/route')

    const req = makeGetRequest()
    const res = await GET(req)

    expect(res.status).toBe(500)
  })
})
