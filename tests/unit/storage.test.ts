import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// ─── Views ────────────────────────────────────────────────────────────────────

describe('getViews', () => {
  it('returns empty array when views file does not exist', async () => {
    const { getViews } = await import('@/lib/storage')
    const views = getViews()
    expect(views).toEqual([])
  })
})

describe('createView', () => {
  it('creates a view with generated id and timestamps', async () => {
    const { createView, getViews } = await import('@/lib/storage')

    const created = createView({
      thesis: 'Fed will cut rates',
      direction: 'DOVISH',
      conviction: 'HIGH',
      timeframe: 'through 2025-12-31',
      affects_category: 'Economics/Finance',
      affects_keywords: ['fed', 'rate', 'fomc'],
      p_implied: 0.7,
      notes: 'Strong signal',
    })

    expect(created.id).toMatch(/^view-\d+-[a-z0-9]{5}$/)
    expect(created.thesis).toBe('Fed will cut rates')
    expect(created.conviction).toBe('HIGH')
    expect(created.created_at).toBeTruthy()
    expect(created.updated_at).toBeTruthy()

    const all = getViews()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(created.id)
  })

  it('persists multiple views independently', async () => {
    const { createView, getViews } = await import('@/lib/storage')

    createView({
      thesis: 'View A',
      direction: 'UP',
      conviction: 'LOW',
      timeframe: 'through 2025-06-30',
      affects_category: 'Sports',
      affects_keywords: [],
      p_implied: null,
      notes: '',
    })
    createView({
      thesis: 'View B',
      direction: 'DOWN',
      conviction: 'MEDIUM',
      timeframe: 'through 2025-12-31',
      affects_category: 'Politics & Elections',
      affects_keywords: ['election'],
      p_implied: 0.4,
      notes: '',
    })

    const all = getViews()
    expect(all).toHaveLength(2)
    expect(all[0].thesis).toBe('View A')
    expect(all[1].thesis).toBe('View B')
  })
})

describe('updateView', () => {
  it('merges partial updates and bumps updated_at', async () => {
    const { createView, updateView } = await import('@/lib/storage')

    const view = createView({
      thesis: 'Original thesis',
      direction: 'UP',
      conviction: 'LOW',
      timeframe: 'through 2025-12-31',
      affects_category: 'Other/General',
      affects_keywords: [],
      p_implied: null,
      notes: '',
    })

    const originalUpdatedAt = view.updated_at
    await new Promise((r) => setTimeout(r, 5)) // ensure time difference

    const updated = updateView(view.id, { conviction: 'HIGH', notes: 'changed' })

    expect(updated.conviction).toBe('HIGH')
    expect(updated.notes).toBe('changed')
    expect(updated.thesis).toBe('Original thesis') // unchanged fields preserved
    expect(updated.id).toBe(view.id) // id cannot be changed
    expect(updated.updated_at).not.toBe(originalUpdatedAt)
  })

  it('throws when view id does not exist', async () => {
    const { updateView } = await import('@/lib/storage')
    expect(() => updateView('non-existent-id', { notes: 'x' })).toThrow('not found')
  })
})

describe('deleteView', () => {
  it('removes the view by id', async () => {
    const { createView, deleteView, getViews } = await import('@/lib/storage')

    const v1 = createView({
      thesis: 'To delete',
      direction: 'UP',
      conviction: 'LOW',
      timeframe: 'through 2025-12-31',
      affects_category: 'Other/General',
      affects_keywords: [],
      p_implied: null,
      notes: '',
    })
    const v2 = createView({
      thesis: 'Keep me',
      direction: 'DOWN',
      conviction: 'MEDIUM',
      timeframe: 'through 2025-12-31',
      affects_category: 'Other/General',
      affects_keywords: [],
      p_implied: null,
      notes: '',
    })

    deleteView(v1.id)
    const remaining = getViews()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(v2.id)
  })

  it('is a no-op when id does not exist', async () => {
    const { createView, deleteView, getViews } = await import('@/lib/storage')

    createView({
      thesis: 'Existing',
      direction: 'UP',
      conviction: 'LOW',
      timeframe: 'through 2025-12-31',
      affects_category: 'Other/General',
      affects_keywords: [],
      p_implied: null,
      notes: '',
    })

    expect(() => deleteView('ghost-id')).not.toThrow()
    expect(getViews()).toHaveLength(1)
  })
})

// ─── Session ──────────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns default session when file does not exist', async () => {
    const { getSession } = await import('@/lib/storage')
    const session = getSession()
    expect(session.current_bankroll).toBe(10000)
    expect(session.positions).toEqual([])
    expect(session.kelly_modifier).toBe(1.0)
  })
})

describe('saveSession / getSession', () => {
  it('persists and retrieves session state', async () => {
    const { getSession, saveSession } = await import('@/lib/storage')

    const session = getSession()
    session.current_bankroll = 12500
    session.kelly_modifier = 0.75
    saveSession(session)

    const retrieved = getSession()
    expect(retrieved.current_bankroll).toBe(12500)
    expect(retrieved.kelly_modifier).toBe(0.75)
  })
})

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('getSettings', () => {
  it('returns defaults when settings file does not exist', async () => {
    const { getSettings } = await import('@/lib/storage')
    const settings = getSettings()
    expect(settings.anthropic_api_key).toBe('')
    expect(settings.kalshi_api_key).toBe('')
    expect(settings.min_edge_threshold).toBe(0.03)
    expect(settings.max_position_pct).toBe(0.05)
    expect(settings.default_kelly_fraction).toBe('medium')
  })
})

describe('saveSettings / getSettings', () => {
  it('persists and retrieves API keys and thresholds', async () => {
    const { getSettings, saveSettings } = await import('@/lib/storage')

    const settings = getSettings()
    settings.anthropic_api_key = 'sk-ant-test-key'
    settings.kalshi_api_key = 'kx-test-key'
    settings.min_edge_threshold = 0.05
    saveSettings(settings)

    const retrieved = getSettings()
    expect(retrieved.anthropic_api_key).toBe('sk-ant-test-key')
    expect(retrieved.kalshi_api_key).toBe('kx-test-key')
    expect(retrieved.min_edge_threshold).toBe(0.05)
  })
})
