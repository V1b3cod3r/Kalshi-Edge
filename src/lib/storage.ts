import fs from 'fs'
import path from 'path'
import { MacroView, SessionState, AppSettings, AutopilotSettings, AutopilotRun, Prediction, CalibrationStats, EdgeBucketStats, Lesson } from './types'

// Support DATA_DIR env var for cloud deployments (Railway mounts a volume here)
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

const VIEWS_FILE = path.join(DATA_DIR, 'views.json')
const SESSION_FILE = path.join(DATA_DIR, 'session.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json')
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json')
const AUTOPILOT_LOG_FILE = path.join(DATA_DIR, 'autopilot_log.json')

const DEFAULT_SESSION: SessionState = {
  current_bankroll: 10000,
  starting_bankroll: 10000,
  positions: [],
  corr_groups: {},
  recent_win_rate: 0.58,
  kelly_modifier: 1.0,
  avoid_categories: [],
  max_new_positions: 5,
}

// Conservative-by-default autopilot guardrails. Autopilot ships disabled AND
// in dry-run mode — two independent switches must be flipped before any real
// order can be placed.
const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: false,
  dry_run: true,
  // Set at the measured calibration floor, not a hopeful guess. KalshiBench
  // (300 real Kalshi questions, 5 frontier models) found Claude Opus 4.5 —
  // the BEST of the five — has ECE 0.120 on genuinely-unknown future events.
  // A threshold below that floor is mostly sampling the model's own
  // calibration error, not detecting real mispricing (see scan.ts:
  // MIN_EFFECTIVE_EDGE for the full citation). 15pp sits just above that
  // floor. Re-tune from YOUR OWN measured ECE (getCalibrationStats) once
  // enough predictions have resolved — do not lower this on a hunch.
  min_effective_edge_pct: 15,
  min_confidence: 'HIGH',
  max_per_trade_usd: 25,
  max_daily_spend_usd: 100,
  max_daily_loss_usd: 50,
  max_open_positions: 10,
  max_exposure_usd: 250,
  kelly_fraction: 0.25,
  category_blacklist: ['Sports'],
  max_per_cluster_usd: 50,
  // Off by default. A live-money weather-market study (562 trades) found
  // every configuration using profit-taking or stop-losses destroyed value
  // versus holding to resolution — a binary contract converging to 0 or 1 has
  // no momentum to cut, so a fixed-% stop-loss sells exactly when the entry
  // thesis (per the shrunk estimate) has gotten STRONGER, not weaker. Still
  // available for anyone who wants to test it themselves; just not assumed.
  exit_enabled: false,
  take_profit_pct: 40,
  scan_limit: 40,
  max_days_to_resolution: 45,
  min_resolved_predictions_for_live: 30,
  // Off at the user's explicit request — see AutopilotSettings comment.
  require_calibration_to_go_live: false,
  kelly_haircut_high_pp: 3,
  kelly_haircut_medium_pp: 5,
  kelly_haircut_low_pp: 8,
  // Off by default (opt-in). Kalshi's taker economics (300k+ contracts
  // studied) average ~32% loss; makers average ~10%. Resting buy orders as
  // maker/post_only cuts the fee 4x (or to zero on some series) at the cost
  // of fill-rate uncertainty — a real tradeoff, so not assumed on by default.
  use_maker_orders: false,
}

const DEFAULT_SETTINGS: AppSettings = {
  anthropic_api_key: '',
  kalshi_api_key: '',
  kalshi_private_key: '',
  tavily_api_key: '',
  min_edge_threshold: 0.03,
  max_position_pct: 0.05,
  max_corr_exposure_pct: 0.15,
  default_kelly_fraction: 'medium',
  use_extended_thinking: false,
  // Sonnet 5 for breadth scans by default: the scanner's estimates are shrunk
  // 60/40 toward market price and gated in code, so triage quality is the
  // binding constraint far less than cost. Deep analysis stays on Opus 4.8.
  scanner_model: 'claude-sonnet-5',
  autopilot: DEFAULT_AUTOPILOT,
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readJson<T>(filePath: string, defaultValue: T): T {
  ensureDataDir()
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, defaultValue)
    return defaultValue
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (err) {
    // NEVER silently substitute defaults for a corrupt file: the next save
    // would persist those defaults and permanently erase the real history
    // (bankroll, predictions, calibration). Preserve the corrupt file aside
    // for manual recovery and scream about it.
    const backup = `${filePath}.corrupt-${Date.now()}`
    try { fs.renameSync(filePath, backup) } catch {}
    console.error(
      `[storage] CORRUPT DATA FILE: ${filePath} failed to parse and was moved to ${backup}. ` +
      `Falling back to defaults — recover the backup manually if this file mattered.`,
      err
    )
    return defaultValue
  }
}

function writeJson<T>(filePath: string, data: T): void {
  ensureDataDir()
  // Atomic write: a crash mid-write must never leave torn JSON at the real
  // path (torn JSON reads as "corrupt" and triggers the recovery path above).
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath)
}

// Views CRUD
export function getViews(): MacroView[] {
  return readJson<MacroView[]>(VIEWS_FILE, [])
}

export function saveViews(views: MacroView[]): void {
  writeJson(VIEWS_FILE, views)
}

export function getView(id: string): MacroView | null {
  const views = getViews()
  return views.find((v) => v.id === id) || null
}

export function createView(
  view: Omit<MacroView, 'id' | 'created_at' | 'updated_at'>
): MacroView {
  const views = getViews()
  const now = new Date().toISOString()
  const newView: MacroView = {
    ...view,
    id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: now,
    updated_at: now,
  }
  views.push(newView)
  saveViews(views)
  return newView
}

export function updateView(id: string, updates: Partial<MacroView>): MacroView {
  const views = getViews()
  const idx = views.findIndex((v) => v.id === id)
  if (idx === -1) throw new Error(`View ${id} not found`)
  const updated: MacroView = {
    ...views[idx],
    ...updates,
    id, // ensure id can't be changed
    updated_at: new Date().toISOString(),
  }
  views[idx] = updated
  saveViews(views)
  return updated
}

export function deleteView(id: string): void {
  const views = getViews()
  const filtered = views.filter((v) => v.id !== id)
  saveViews(filtered)
}

// Session
export function getSession(): SessionState {
  return readJson<SessionState>(SESSION_FILE, DEFAULT_SESSION)
}

export function saveSession(session: SessionState): void {
  writeJson(SESSION_FILE, session)
}

// Predictions
export function getPredictions(): Prediction[] {
  return readJson<Prediction[]>(PREDICTIONS_FILE, [])
}

export function savePredictions(predictions: Prediction[]): void {
  writeJson(PREDICTIONS_FILE, predictions)
}

export function createPrediction(
  data: Omit<Prediction, 'id' | 'created_at'>
): Prediction {
  const predictions = getPredictions()
  const prediction: Prediction = {
    ...data,
    id: `pred-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
  }
  predictions.unshift(prediction) // newest first
  savePredictions(predictions)
  return prediction
}

export function resolvePrediction(id: string, outcome: 'YES' | 'NO'): Prediction {
  const predictions = getPredictions()
  const idx = predictions.findIndex((p) => p.id === id)
  if (idx === -1) throw new Error(`Prediction ${id} not found`)
  predictions[idx] = {
    ...predictions[idx],
    outcome,
    resolved_at: new Date().toISOString(),
  }
  savePredictions(predictions)
  return predictions[idx]
}

export function deletePrediction(id: string): void {
  const predictions = getPredictions()
  savePredictions(predictions.filter((p) => p.id !== id))
}

export function updatePrediction(id: string, updates: Partial<Prediction>): Prediction {
  const predictions = getPredictions()
  const idx = predictions.findIndex((p) => p.id === id)
  if (idx === -1) throw new Error(`Prediction ${id} not found`)
  predictions[idx] = { ...predictions[idx], ...updates }
  savePredictions(predictions)
  return predictions[idx]
}

// Lessons — self-correcting AI memory store
export function getLessons(): Lesson[] {
  return readJson<Lesson[]>(LESSONS_FILE, [])
}

export function saveLessons(lessons: Lesson[]): void {
  writeJson(LESSONS_FILE, lessons)
}

export function createLesson(data: Omit<Lesson, 'id' | 'created_at'>): Lesson {
  const lessons = getLessons()
  const lesson: Lesson = {
    ...data,
    id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
  }
  lessons.unshift(lesson)
  saveLessons(lessons)
  return lesson
}

export function getRelevantLessons(category: string, keywords: string[], limit = 5): Lesson[] {
  const lessons = getLessons()
  if (lessons.length === 0) return []

  const scored = lessons.map((l) => {
    let score = 0
    if (l.category === category) score += 3
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase()
      if (l.keywords.some((k) => k.toLowerCase().includes(kwLower) || kwLower.includes(k.toLowerCase()))) {
        score += 2
      }
    }
    // Recency boost: lessons from last 30 days score slightly higher
    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays < 30) score += 1
    return { lesson: l, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.lesson.created_at).getTime() - new Date(a.lesson.created_at).getTime())
    .slice(0, limit)
    .map((s) => s.lesson)
}

// Calibration stats — computed on the fly from resolved predictions
export function getCalibrationStats(): CalibrationStats {
  const predictions = getPredictions()
  const resolved = predictions.filter((p) => p.outcome !== undefined)

  const empty: CalibrationStats = {
    total_predictions: predictions.length,
    resolved_predictions: resolved.length,
    overall_accuracy: 0,
    brier_score: 0.25,
    claude_brier: 0.25,
    market_brier: null,
    claude_vs_market: 'Insufficient data',
    yes_bias: 0,
    recent_accuracy: 0,
    recent_win_rate: null,
    by_source: {
      scanner: { count: 0, brier: null, win_rate: null },
      analyze: { count: 0, brier: null, win_rate: null },
    },
    by_category: {},
    by_edge_bucket: [],
    market_brier_midpoint_samples: 0,
  }

  if (resolved.length === 0) return empty

  // Overall accuracy: direction correct (direction === outcome)
  const correct = resolved.filter((p) => p.direction === p.outcome)
  const overall_accuracy = correct.length / resolved.length

  // Claude's Brier score: (predicted_prob_for_yes - actual_yes_outcome)^2
  // predicted_prob_for_yes = p.predicted_probability (always the P(YES))
  // actual = 1 if outcome=YES, 0 if outcome=NO
  const brierSum = resolved.reduce((sum, p) => {
    const actual = p.outcome === 'YES' ? 1 : 0
    return sum + Math.pow(p.predicted_probability - actual, 2)
  }, 0)
  const brier_score = brierSum / resolved.length
  const claude_brier = brier_score

  // Market Brier score: (market_prob - actual_outcome)^2.
  //
  // Score the market at its MIDPOINT where a two-sided quote was captured.
  // market_price is the YES ASK, which is biased upward by half the spread —
  // using it hands Claude free advantage on every observation. Prefer
  // midpoint rows; fall back to ask-priced legacy rows only when no midpoint
  // rows exist at all, and report the sample count so the UI can flag a
  // fallback comparison as biased rather than presenting it as clean.
  const marketProbOf = (p: Prediction): number | null => {
    if (p.market_yes_bid != null && p.market_yes_ask != null) {
      return (p.market_yes_bid + p.market_yes_ask) / 2
    }
    return null
  }
  const resolvedWithMidpoint = resolved.filter((p) => marketProbOf(p) != null)
  const market_brier_midpoint_samples = resolvedWithMidpoint.length

  let market_brier: number | null = null
  const brierAgainst = (rows: Prediction[], probOf: (p: Prediction) => number) => {
    const sum = rows.reduce((acc, p) => {
      const actual = p.outcome === 'YES' ? 1 : 0
      return acc + Math.pow(probOf(p) - actual, 2)
    }, 0)
    return parseFloat((sum / rows.length).toFixed(4))
  }
  if (resolvedWithMidpoint.length > 0) {
    market_brier = brierAgainst(resolvedWithMidpoint, (p) => marketProbOf(p)!)
  } else {
    const resolvedWithMarket = resolved.filter((p) => p.market_price != null)
    if (resolvedWithMarket.length > 0) {
      market_brier = brierAgainst(resolvedWithMarket, (p) => p.market_price)
    }
  }

  // Claude vs market comparison string.
  //
  // Compare on the SAME rows: scoring Claude over every resolved prediction
  // while scoring the market over only the subset with a two-sided quote is
  // not apples-to-apples and can flip the verdict on its own.
  const comparisonRows = resolvedWithMidpoint.length > 0
    ? resolvedWithMidpoint
    : resolved.filter((p) => p.market_price != null)
  const claudeBrierOnComparisonRows = comparisonRows.length > 0
    ? brierAgainst(comparisonRows, (p) => p.predicted_probability)
    : null

  let claude_vs_market: string
  if (comparisonRows.length < 10 || market_brier === null || claudeBrierOnComparisonRows === null) {
    claude_vs_market = `Insufficient data (${comparisonRows.length}/10 comparable resolved predictions)`
  } else {
    const biasNote = resolvedWithMidpoint.length === 0
      ? ' — NOTE: scored against the ask, not the midpoint; this flatters Claude by ~half the spread'
      : ''
    claude_vs_market = claudeBrierOnComparisonRows < market_brier
      ? `Claude beats market (${claudeBrierOnComparisonRows.toFixed(3)} vs ${market_brier.toFixed(3)}, n=${comparisonRows.length})${biasNote}`
      : `Market beats Claude (${market_brier.toFixed(3)} vs ${claudeBrierOnComparisonRows.toFixed(3)}, n=${comparisonRows.length})${biasNote}`
  }

  // --- Realized ROI by claimed-edge bucket ---------------------------------
  // The go/no-go metric. Computed purely from predictions + outcomes (no
  // settlements join) so it works in dry-run, where nothing ever settles on
  // Kalshi. Payoff per contract: win → (1 − entry), loss → −entry. ROI is
  // Σpayoff / Σcost, i.e. return per dollar actually risked.
  //
  // Only `actionable` rows count: non-actionable rows were evaluated but
  // never trade candidates, so including them would misstate trading returns.
  // (Legacy rows predate the flag and were all actionable → treated as true.)
  const EDGE_BUCKETS: Array<{ label: string; min: number; max: number }> = [
    { label: '0-2%', min: -Infinity, max: 2 },
    { label: '2-4%', min: 2, max: 4 },
    { label: '4-6%', min: 4, max: 6 },
    { label: '6-10%', min: 6, max: 10 },
    { label: '10%+', min: 10, max: Infinity },
  ]
  const actionablePreds = predictions.filter((p) => p.actionable !== false)
  const by_edge_bucket: EdgeBucketStats[] = EDGE_BUCKETS.map(({ label, min, max }) => {
    const inBucket = actionablePreds.filter((p) => p.edge_pct >= min && p.edge_pct < max)
    const settled = inBucket.filter((p) => p.outcome !== undefined)

    let realized_roi_pct: number | null = null
    let hit_rate: number | null = null
    if (settled.length > 0) {
      hit_rate = settled.filter((p) => p.direction === p.outcome).length / settled.length
      // Entry price: prefer the recorded execution price; otherwise derive it
      // from market_price (YES ask, so a NO entry costs 1 − that).
      const priced = settled.filter((p) => {
        const entry = p.execution_price ?? (p.direction === 'YES' ? p.market_price : 1 - p.market_price)
        return Number.isFinite(entry) && entry > 0 && entry < 1
      })
      if (priced.length > 0) {
        let cost = 0
        let payoff = 0
        for (const p of priced) {
          const entry = p.execution_price ?? (p.direction === 'YES' ? p.market_price : 1 - p.market_price)
          cost += entry
          payoff += p.direction === p.outcome ? 1 - entry : -entry
        }
        realized_roi_pct = cost > 0 ? parseFloat(((payoff / cost) * 100).toFixed(1)) : null
      }
    }

    return {
      bucket: label,
      count: inBucket.length,
      resolved: settled.length,
      claimed_edge_avg: inBucket.length > 0
        ? parseFloat((inBucket.reduce((s, p) => s + p.edge_pct, 0) / inBucket.length).toFixed(2))
        : 0,
      realized_roi_pct,
      hit_rate: hit_rate != null ? parseFloat(hit_rate.toFixed(3)) : null,
    }
  })

  // YES bias: mean predicted P(YES) minus observed YES rate
  // Positive = Claude systematically overestimates YES probability
  // Negative = underestimates
  const resolvedWithProb = resolved.filter(p => p.predicted_probability != null)
  const mean_predicted_yes = resolvedWithProb.length > 0
    ? resolvedWithProb.reduce((s, p) => s + p.predicted_probability, 0) / resolvedWithProb.length
    : 0.5
  const observed_yes_rate = resolved.length > 0
    ? resolved.filter(p => p.outcome === 'YES').length / resolved.length
    : 0.5
  const yes_bias = parseFloat((mean_predicted_yes - observed_yes_rate).toFixed(3))

  // Recent accuracy (last 10 resolved)
  const recent10 = resolved.slice(0, 10)
  const recent_accuracy = recent10.length > 0
    ? recent10.filter((p) => p.direction === p.outcome).length / recent10.length
    : 0

  // recent_win_rate: null when fewer than 10 resolved predictions (insufficient data)
  const recent_win_rate: number | null = resolved.length >= 10 ? recent_accuracy : null

  // Source segmentation: scanner vs analyze
  function computeSourceStats(source: 'scanner' | 'analyze') {
    const preds = resolved.filter(p => p.source === source)
    if (preds.length === 0) return { count: 0, brier: null, win_rate: null }
    const bSum = preds.reduce((s, p) => {
      const actual = p.outcome === 'YES' ? 1 : 0
      return s + Math.pow(p.predicted_probability - actual, 2)
    }, 0)
    const correctCount = preds.filter(p => p.direction === p.outcome).length
    return {
      count: preds.length,
      brier: parseFloat((bSum / preds.length).toFixed(4)),
      win_rate: parseFloat((correctCount / preds.length).toFixed(3)),
    }
  }

  const by_source = {
    scanner: computeSourceStats('scanner'),
    analyze: computeSourceStats('analyze'),
  }

  // Per-category stats
  const by_category: CalibrationStats['by_category'] = {}
  for (const p of resolved) {
    const cat = p.category || 'Other/General'
    if (!by_category[cat]) by_category[cat] = { predictions: 0, accuracy: 0, brier: 0 }
    by_category[cat].predictions++
    if (p.direction === p.outcome) by_category[cat].accuracy++
    const actual = p.outcome === 'YES' ? 1 : 0
    by_category[cat].brier += Math.pow(p.predicted_probability - actual, 2)
  }
  for (const cat of Object.keys(by_category)) {
    const d = by_category[cat]
    d.brier = d.brier / d.predictions
    d.accuracy = d.accuracy / d.predictions
  }

  return {
    total_predictions: predictions.length,
    resolved_predictions: resolved.length,
    overall_accuracy,
    brier_score,
    claude_brier,
    market_brier,
    claude_vs_market,
    yes_bias,
    recent_accuracy,
    recent_win_rate,
    by_source,
    by_category,
    by_edge_bucket,
    market_brier_midpoint_samples,
  }
}

// Settings
export function getSettings(): AppSettings {
  const saved = readJson<Partial<AppSettings>>(SETTINGS_FILE, {})
  // Merge with defaults so missing fields never produce NaN/undefined.
  // Deep-merge the autopilot block: existing settings files may predate it
  // entirely, or have it but be missing newer guardrail fields.
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    autopilot: { ...DEFAULT_AUTOPILOT, ...(saved.autopilot ?? {}) },
  }
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_FILE, settings)
}

// Autopilot run log — newest first
export function getAutopilotRuns(limit?: number): AutopilotRun[] {
  const runs = readJson<AutopilotRun[]>(AUTOPILOT_LOG_FILE, [])
  return limit && limit > 0 ? runs.slice(0, limit) : runs
}

const MAX_AUTOPILOT_RUNS = 200

export function appendAutopilotRun(run: AutopilotRun): void {
  const runs = readJson<AutopilotRun[]>(AUTOPILOT_LOG_FILE, [])
  runs.unshift(run) // newest first
  writeJson(AUTOPILOT_LOG_FILE, runs.slice(0, MAX_AUTOPILOT_RUNS))
}
