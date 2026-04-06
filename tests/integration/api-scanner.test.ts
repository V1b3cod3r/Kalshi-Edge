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
  return new NextRequest('http://localhost/api/scanner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleMarkets = [
  { title: 'Will inflation fall below 3%?', yes_price: 0.6, no_price: 0.4, volume_24h: 1000 },
  { title: 'Will the Packers win the Super Bowl?', yes_price: 0.15, no_price: 0.85, volume_24h: 5000 },
]

describe('POST /api/scanner', () => {
  it('returns 400 when markets array is empty', async () => {
    const { POST } = await import('@/app/api/scanner/route')

    const req = makeRequest({ markets: [] })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('At least one market')
  })

  it('returns 400 when markets is missing', async () => {
    const { POST } = await import('@/app/api/scanner/route')

    const req = makeRequest({})
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when Anthropic API key not configured', async () => {
    const { POST } = await import('@/app/api/scanner/route')

    const req = makeRequest({ markets: sampleMarkets })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data.error).toContain('Anthropic')
  })

  it('returns scan result when API key is configured', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Market Scan Results\n\nTop opportunity: inflation market.' }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/scanner/route')

    const req = makeRequest({ markets: sampleMarkets })
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.result).toContain('Market Scan Results')
  })

  it('passes all market titles to Claude', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-key'
    saveSettings(settings)

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Scan complete' }],
    })

    vi.resetModules()
    const { POST } = await import('@/app/api/scanner/route')

    const req = makeRequest({ markets: sampleMarkets })
    await POST(req)

    const callArgs = mockCreate.mock.calls[0][0]
    const userMsg = callArgs.messages[0].content
    expect(userMsg).toContain('Will inflation fall below 3%?')
    expect(userMsg).toContain('Will the Packers win the Super Bowl?')
  })
})
