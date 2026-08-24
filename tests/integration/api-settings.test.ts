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
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeRequest(method: string, body?: object): NextRequest {
  return new NextRequest('http://localhost/api/settings', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/settings', () => {
  it('returns default settings with empty API keys', async () => {
    const { GET } = await import('@/app/api/settings/route')

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.settings.anthropic_api_key).toBe('')
    expect(data.settings.kalshi_api_key).toBe('')
    expect(data.settings.min_edge_threshold).toBe(0.03)
    expect(data.settings.max_position_pct).toBe(0.05)
    expect(data.settings.default_kelly_fraction).toBe('medium')
  })

  it('masks API keys in the response', async () => {
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-abcdefghijklmno1234'
    settings.kalshi_api_key = 'kx-live-test-key-xyz'
    saveSettings(settings)

    vi.resetModules()
    const { GET } = await import('@/app/api/settings/route')

    const res = await GET()
    const data = await res.json()

    expect(data.settings.anthropic_api_key).toContain('••••')
    expect(data.settings.anthropic_api_key).not.toBe('sk-ant-test-abcdefghijklmno1234')
    expect(data.settings.kalshi_api_key).toContain('••••')
  })
})

describe('PUT /api/settings', () => {
  it('saves new settings and returns masked keys', async () => {
    const { PUT } = await import('@/app/api/settings/route')

    const req = makeRequest('PUT', {
      anthropic_api_key: 'sk-ant-new-key-testing',
      kalshi_api_key: 'kx-new-key',
      min_edge_threshold: 0.05,
    })

    const res = await PUT(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.settings.min_edge_threshold).toBe(0.05)
    expect(data.settings.anthropic_api_key).toContain('••••')
  })

  it('does not overwrite API key when masked value is sent back', async () => {
    // First, save a real key
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-real-key-value'
    saveSettings(settings)

    vi.resetModules()
    const { PUT } = await import('@/app/api/settings/route')

    // Send back a masked value (as if user didn't change it)
    const req = makeRequest('PUT', {
      anthropic_api_key: 'sk-a••••••••lue',
      min_edge_threshold: 0.04,
    })

    await PUT(req)

    // Reload storage and verify original key is preserved
    vi.resetModules()
    const { getSettings: freshGetSettings } = await import('@/lib/storage')
    const saved = freshGetSettings()
    expect(saved.anthropic_api_key).toBe('sk-ant-real-key-value')
    expect(saved.min_edge_threshold).toBe(0.04)
  })
})

describe('PUT /api/settings — autopilot guardrail validation (REAL MONEY: must fail closed)', () => {
  // Previously the only bound anywhere was a client-side HTML min/max
  // attribute on the autopilot page's <input> — trivially bypassed by a
  // direct API call like these. A bad write (a typo appending a zero) to a
  // dollar-denominated guardrail defeated that specific guardrail with zero
  // code-level resistance.
  it('rejects a kelly_fraction above 1 (would exceed max_per_trade_usd\'s own headroom clamp meaning, but bypasses the intent) and persists nothing', async () => {
    const { PUT } = await import('@/app/api/settings/route')
    const req = makeRequest('PUT', { autopilot: { kelly_fraction: 5 } })

    const res = await PUT(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('kelly_fraction')

    vi.resetModules()
    const { getSettings } = await import('@/lib/storage')
    expect(getSettings().autopilot.kelly_fraction).toBe(0.25) // untouched default
  })

  it('rejects a negative max_daily_loss_usd', async () => {
    const { PUT } = await import('@/app/api/settings/route')
    const req = makeRequest('PUT', { autopilot: { max_daily_loss_usd: -10 } })

    const res = await PUT(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('max_daily_loss_usd')
  })

  it('rejects max_per_trade_usd exceeding max_daily_spend_usd (ordering constraint)', async () => {
    const { PUT } = await import('@/app/api/settings/route')
    const req = makeRequest('PUT', {
      autopilot: { max_per_trade_usd: 500, max_daily_spend_usd: 100 },
    })

    const res = await PUT(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('max_per_trade_usd cannot exceed max_daily_spend_usd')
  })

  it('validates against the FINAL merged settings, not just fields present in this PUT', async () => {
    // Seed max_exposure_usd artificially low first, then a later partial
    // update to max_daily_spend_usd alone must still be checked against it.
    const { saveSettings, getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    settings.autopilot.max_exposure_usd = 50
    saveSettings(settings)

    vi.resetModules()
    const { PUT } = await import('@/app/api/settings/route')
    const req = makeRequest('PUT', { autopilot: { max_daily_spend_usd: 200 } })

    const res = await PUT(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('max_daily_spend_usd cannot exceed max_exposure_usd')
  })

  it('accepts a legitimate change (raising max_exposure_usd as the account grows)', async () => {
    const { PUT } = await import('@/app/api/settings/route')
    const req = makeRequest('PUT', { autopilot: { max_exposure_usd: 1000 } })

    const res = await PUT(req)
    expect(res.status).toBe(200)

    vi.resetModules()
    const { getSettings } = await import('@/lib/storage')
    expect(getSettings().autopilot.max_exposure_usd).toBe(1000)
  })
})
