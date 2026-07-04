import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { Prediction } from '@/lib/types'

// Storage resolves DATA_DIR from process.env.DATA_DIR at module load, so the
// env var must be set before each dynamic import (vi.resetModules forces a
// fresh module evaluation per test).

let tmpDir: string
const ORIGINAL_DATA_DIR = process.env.DATA_DIR

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-storage-'))
  process.env.DATA_DIR = tmpDir
  vi.resetModules()
})

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

async function loadStorage() {
  return import('@/lib/storage')
}

function makePrediction(overrides: Partial<Prediction>): Prediction {
  return {
    id: `pred-${Math.random().toString(36).slice(2, 10)}`,
    market_title: 'Test market',
    category: 'Economics/Finance',
    predicted_probability: 0.5,
    direction: 'YES',
    market_price: 0.5,
    edge_pct: 5,
    created_at: new Date().toISOString(),
    source: 'scanner',
    ...overrides,
  }
}

// ─── Corrupt-file recovery ─────────────────────────────────────────────────────

describe('corrupt data file handling', () => {
  it('returns defaults and preserves the corrupt file aside (never deletes it)', async () => {
    const garbage = '{"current_bankroll": 123, TRUNCATED MID-WR'
    writeFileSync(path.join(tmpDir, 'session.json'), garbage)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { getSession } = await loadStorage()
    const session = getSession()

    // Falls back to defaults instead of throwing
    expect(session.current_bankroll).toBe(10000)
    expect(session.positions).toEqual([])

    // The corrupt file is renamed aside for manual recovery, not deleted
    const files = readdirSync(tmpDir)
    const backups = files.filter((f) => /^session\.json\.corrupt-\d+$/.test(f))
    expect(backups).toHaveLength(1)
    expect(readFileSync(path.join(tmpDir, backups[0]), 'utf-8')).toBe(garbage)
    // ...and it screams about it
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('CORRUPT DATA FILE'),
      expect.anything()
    )
  })

  it('does not let a corrupt predictions file erase calibration history silently', async () => {
    const garbage = 'not json at all'
    writeFileSync(path.join(tmpDir, 'predictions.json'), garbage)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { getPredictions } = await loadStorage()
    expect(getPredictions()).toEqual([])

    const backups = readdirSync(tmpDir).filter((f) => f.startsWith('predictions.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(path.join(tmpDir, backups[0]), 'utf-8')).toBe(garbage)
  })
})

// ─── Atomic writes ────────────────────────────────────────────────────────────

describe('atomic writes (tmp + rename)', () => {
  it('leaves no .tmp file behind and writes valid JSON', async () => {
    const { getSession, saveSession } = await loadStorage()

    const session = getSession()
    session.current_bankroll = 4242
    saveSession(session)

    const files = readdirSync(tmpDir)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
    expect(existsSync(path.join(tmpDir, 'session.json'))).toBe(true)

    // Final file parses cleanly and round-trips the data
    const onDisk = JSON.parse(readFileSync(path.join(tmpDir, 'session.json'), 'utf-8'))
    expect(onDisk.current_bankroll).toBe(4242)
    expect(getSession().current_bankroll).toBe(4242)
  })

  it('overwrites an existing file atomically on repeated saves', async () => {
    const { getSession, saveSession, savePredictions } = await loadStorage()

    for (const bankroll of [100, 200, 300]) {
      const s = getSession()
      s.current_bankroll = bankroll
      saveSession(s)
    }
    savePredictions([makePrediction({ id: 'p1' })])

    const files = readdirSync(tmpDir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(getSession().current_bankroll).toBe(300)
    const preds = JSON.parse(readFileSync(path.join(tmpDir, 'predictions.json'), 'utf-8'))
    expect(preds).toHaveLength(1)
  })
})

// ─── Calibration stats ────────────────────────────────────────────────────────

describe('getCalibrationStats', () => {
  // Hand-built fixture (4 resolved, 1 pending):
  //   #1 scanner  pred 0.8 YES  market 0.6  outcome YES  → correct
  //   #2 scanner  pred 0.7 YES  market 0.5  outcome NO   → wrong
  //   #3 analyze  pred 0.4 NO   market 0.5  outcome NO   → correct
  //   #4 analyze  pred 0.3 NO   market 0.4  outcome YES  → wrong
  const fixture = () => [
    makePrediction({ id: 'p1', source: 'scanner', predicted_probability: 0.8, direction: 'YES', market_price: 0.6, outcome: 'YES', resolved_at: new Date().toISOString() }),
    makePrediction({ id: 'p2', source: 'scanner', predicted_probability: 0.7, direction: 'YES', market_price: 0.5, outcome: 'NO', resolved_at: new Date().toISOString() }),
    makePrediction({ id: 'p3', source: 'analyze', predicted_probability: 0.4, direction: 'NO', market_price: 0.5, outcome: 'NO', resolved_at: new Date().toISOString() }),
    makePrediction({ id: 'p4', source: 'analyze', predicted_probability: 0.3, direction: 'NO', market_price: 0.4, outcome: 'YES', resolved_at: new Date().toISOString() }),
    makePrediction({ id: 'p5', source: 'scanner', predicted_probability: 0.6, direction: 'YES', market_price: 0.55 }), // unresolved
  ]

  it('computes yes_bias as mean predicted P(YES) minus observed YES rate', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    savePredictions(fixture())

    const stats = getCalibrationStats()
    // mean predicted = (0.8+0.7+0.4+0.3)/4 = 0.55; observed YES = 2/4 = 0.5
    expect(stats.yes_bias).toBeCloseTo(0.05, 3)
    expect(stats.total_predictions).toBe(5)
    expect(stats.resolved_predictions).toBe(4)
  })

  it('computes market_brier from market_price vs outcome', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    savePredictions(fixture())

    const stats = getCalibrationStats()
    // market: (0.6−1)² + (0.5−0)² + (0.5−0)² + (0.4−1)² = 1.02 / 4 = 0.255
    expect(stats.market_brier).toBeCloseTo(0.255, 4)
    // claude: (0.8−1)² + (0.7−0)² + (0.4−0)² + (0.3−1)² = 1.18 / 4 = 0.295
    expect(stats.brier_score).toBeCloseTo(0.295, 4)
    expect(stats.claude_brier).toBeCloseTo(0.295, 4)
  })

  it('returns market_brier null when no resolved prediction has a market price', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    savePredictions([
      makePrediction({ id: 'p1', market_price: undefined as any, outcome: 'YES', resolved_at: new Date().toISOString() }),
    ])

    const stats = getCalibrationStats()
    expect(stats.market_brier).toBeNull()
  })

  it('segments by_source into scanner vs analyze', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    // Extra autopilot prediction must land in NEITHER bucket
    savePredictions([
      ...fixture(),
      makePrediction({ id: 'p6', source: 'autopilot', predicted_probability: 0.9, direction: 'YES', market_price: 0.8, outcome: 'YES', resolved_at: new Date().toISOString() }),
    ])

    const stats = getCalibrationStats()
    // scanner: briers (0.8−1)²=0.04, (0.7−0)²=0.49 → 0.265; wins 1/2
    expect(stats.by_source.scanner.count).toBe(2)
    expect(stats.by_source.scanner.brier).toBeCloseTo(0.265, 4)
    expect(stats.by_source.scanner.win_rate).toBeCloseTo(0.5, 3)
    // analyze: briers (0.4−0)²=0.16, (0.3−1)²=0.49 → 0.325; wins 1/2
    expect(stats.by_source.analyze.count).toBe(2)
    expect(stats.by_source.analyze.brier).toBeCloseTo(0.325, 4)
    expect(stats.by_source.analyze.win_rate).toBeCloseTo(0.5, 3)
  })

  it('returns recent_win_rate null when fewer than 10 predictions are resolved', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    savePredictions(fixture()) // only 4 resolved

    const stats = getCalibrationStats()
    expect(stats.recent_win_rate).toBeNull()
    // recent_accuracy is still reported over what exists (2 correct of 4)
    expect(stats.recent_accuracy).toBeCloseTo(0.5, 3)
  })

  it('reports recent_win_rate once 10 predictions are resolved', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    const many = Array.from({ length: 10 }, (_, i) =>
      makePrediction({
        id: `bulk-${i}`,
        predicted_probability: 0.7,
        direction: 'YES',
        market_price: 0.6,
        // 8 of 10 correct
        outcome: i < 8 ? 'YES' : 'NO',
        resolved_at: new Date().toISOString(),
      })
    )
    savePredictions(many)

    const stats = getCalibrationStats()
    expect(stats.recent_win_rate).toBeCloseTo(0.8, 3)
    expect(stats.overall_accuracy).toBeCloseTo(0.8, 3)
  })

  it('returns the empty-stats shape when nothing is resolved', async () => {
    const { savePredictions, getCalibrationStats } = await loadStorage()
    savePredictions([makePrediction({ id: 'pending' })])

    const stats = getCalibrationStats()
    expect(stats.resolved_predictions).toBe(0)
    expect(stats.brier_score).toBe(0.25)
    expect(stats.market_brier).toBeNull()
    expect(stats.recent_win_rate).toBeNull()
    expect(stats.by_source.scanner).toEqual({ count: 0, brier: null, win_rate: null })
    expect(stats.by_source.analyze).toEqual({ count: 0, brier: null, win_rate: null })
  })
})
