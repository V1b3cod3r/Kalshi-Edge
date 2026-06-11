import fs from 'fs'
import path from 'path'
import { MacroView, SessionState, AppSettings, Prediction, CalibrationStats, Lesson } from './types'

// Support DATA_DIR env var for cloud deployments (Railway mounts a volume here)
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

const VIEWS_FILE = path.join(DATA_DIR, 'views.json')
const SESSION_FILE = path.join(DATA_DIR, 'session.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json')
const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json')

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
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readJson<T>(filePath: string, defaultValue: T): T {
  ensureDataDir()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2))
    return defaultValue
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return defaultValue
  }
}

function writeJson<T>(filePath: string, data: T): void {
  ensureDataDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
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

  // Market Brier score: (market_price - actual_outcome)^2
  const resolvedWithMarket = resolved.filter((p) => p.market_price != null)
  let market_brier: number | null = null
  if (resolvedWithMarket.length > 0) {
    const marketBrierSum = resolvedWithMarket.reduce((sum, p) => {
      const actual = p.outcome === 'YES' ? 1 : 0
      return sum + Math.pow(p.market_price - actual, 2)
    }, 0)
    market_brier = parseFloat((marketBrierSum / resolvedWithMarket.length).toFixed(4))
  }

  // Claude vs market comparison string
  let claude_vs_market: string
  if (resolved.length < 10) {
    claude_vs_market = 'Insufficient data'
  } else if (market_brier === null) {
    claude_vs_market = 'Insufficient data'
  } else if (claude_brier < market_brier) {
    claude_vs_market = `Claude beats market (${claude_brier.toFixed(2)} vs ${market_brier.toFixed(2)})`
  } else {
    claude_vs_market = `Market beats Claude (${market_brier.toFixed(2)} vs ${claude_brier.toFixed(2)})`
  }

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
  }
}

// Settings
export function getSettings(): AppSettings {
  const saved = readJson<Partial<AppSettings>>(SETTINGS_FILE, {})
  // Merge with defaults so missing fields never produce NaN/undefined
  return { ...DEFAULT_SETTINGS, ...saved }
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_FILE, settings)
}
