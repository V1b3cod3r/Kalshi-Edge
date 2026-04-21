import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mockCreate }
    constructor(_opts: any) {}
  },
}))

// Prevent real network calls from signals + search modules
vi.mock('@/lib/signals', () => ({
  getSignalsForMarket: vi.fn().mockResolvedValue([]),
  formatSignals: vi.fn().mockReturnValue(''),
}))
vi.mock('@/lib/search', () => ({
  getMarketWebContext: vi.fn().mockResolvedValue({ query: '', news: [], polymarket: undefined }),
  formatWebContext: vi.fn().mockReturnValue(''),
}))

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  mockCreate.mockReset()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/analyze', () => {
  it('returns 400 when market data is missing', async () => {
    const { POST } = await import('@/app/api/analyze/route')

    const req = makeRequest({})
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Market data')
  })

  it('returns 400 when market title is empty', async () => {
    const { POST } = await import('@/app/api/analyze/route')

    const req = makeRequest({ market: { yes_price: 0.5, no_price: 0.5 } })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when Anthropic API key is not configured', async () => {
    const { POST } = await import('@/app/api/analyze/route')

    const req = makeRequest({
      market: { title: 'Test Market', yes_price: 0.5, no_price: 0.5 },
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Anthropic')
  })

  it('returns analysis result when API key is configured', async () => {
    // Configure settings
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Market Analysis\n\nYES has edge.' }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/analyze/route')

    const req = makeRequest({
      market: {
        title: 'Will inflation fall below 3%?',
        yes_price: 0.6,
        no_price: 0.4,
        volume_24h: 1000,
      },
    })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.result).toContain('Market Analysis')
  })

  it('passes market title to Claude', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Analysis' }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/analyze/route')

    const req = makeRequest({
      market: { title: 'Fed rate cut in December?', yes_price: 0.45, no_price: 0.55 },
    })
    await POST(req)

    const callArgs = mockCreate.mock.calls[0][0]
    const userMsg = callArgs.messages[0].content
    expect(userMsg).toContain('Fed rate cut in December?')
  })
})
