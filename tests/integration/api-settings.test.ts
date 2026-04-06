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
