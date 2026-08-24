import fs from 'fs'
import path from 'path'
import { MacroView, SessionState, AppSettings, AutopilotSettings, AutopilotRun, Prediction, CalibrationStats, EdgeBucketStats, StrategyStats, Lesson, MistakeType, MistakeTypeStats, ConfidenceTierStats, SkipReasonStats, AutopilotFunnelStats } from './types'

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
  // PROVENANCE: the 562-trade study is an INHERITED, unaudited prior — its
  // raw data doesn't exist in this repo and can't be independently verified
  // here. Applied unevenly historically: a stop_loss_pct mechanism was fully
  // code-deleted, while take_profit_pct was kept as this opt-in setting. Once
  // AutopilotTrade/Prediction exit tagging (exited_early/exit_price/exit_ts)
  // has accumulated enough of this system's OWN resolved history, re-test the
  // conclusion on real data rather than assuming either answer.
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

  // Strategy registry — see docs/STRATEGY_EXPANSION_PLAN.md. Original
  // scanner on; both brand-new mechanical strategies off until reviewed.
  strategy_llm_divergence_enabled: true,
  strategy_dated_favorites_enabled: false,
  dated_favorites_min_price_cents: 65,
  dated_favorites_max_price_cents: 90,
  dated_favorites_min_days: 14,
  dated_favorites_max_days: 56,
  dated_favorites_min_volume_usd: 500,
  strategy_settlement_snipe_enabled: false,
  settlement_snipe_margin_f: 2,
  settlement_snipe_max_confidence_pct: 95,
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
  // Every caller of this function feeds the LLM (scan.ts's batch scanner,
  // the analyze routes) — so exclude lessons whose strategy is a mechanical
  // one (dated-favorites, settlement-snipe). Those losses are expected
  // variance around a deterministic, deliberately-conservative model, not a
  // diagnosable REASONING error; surfacing them under a reasoning-error
  // taxonomy (overconfidence, anchoring, ...) would train the LLM on a
  // mislabeled signal. undefined/'llm-divergence' (legacy rows predate the
  // strategy field and were all the LLM scanner) pass through unfiltered.
  const lessons = getLessons().filter((l) => !l.strategy || l.strategy === 'llm-divergence')
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

const ALL_MISTAKE_TYPES: MistakeType[] = [
  'overconfidence', 'base_rate_neglect', 'anchoring', 'news_overreaction', 'thin_market', 'timing_error', 'other',
]

// Groups every extracted lesson by WHY the trade lost. Each lesson is
// already a per-trade post-mortem (see lessons.ts); this is the rollup that
// was missing — nothing previously answered "which failure mode actually
// recurs" without reading every lesson by hand. Always includes all 7 known
// mistake_type values (even zero-count ones) so a summary view can render a
// stable set of rows/bars rather than ones that appear and disappear as data
// accumulates — same convention as by_edge_bucket.
function computeMistakeTypeStats(): MistakeTypeStats[] {
  const lessons = getLessons()
  return ALL_MISTAKE_TYPES.map((mistake_type) => {
    const inType = lessons.filter((l) => l.mistake_type === mistake_type)
    if (inType.length === 0) {
      return { mistake_type, count: 0, avg_edge_claimed_pct: 0, top_categories: [], latest_example: null }
    }
    const avg_edge_claimed_pct = parseFloat(
      (inType.reduce((s, l) => s + l.edge_pct, 0) / inType.length).toFixed(2)
    )
    const categoryCounts = new Map<string, number>()
    for (const l of inType) {
      categoryCounts.set(l.category, (categoryCounts.get(l.category) ?? 0) + 1)
    }
    const top_categories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat)
    // Lessons are unshifted on creation (storage.ts createLesson), so index 0
    // within this filtered set is already the most recent.
    const latest_example = inType[0].what_to_do_differently || null
    return { mistake_type, count: inType.length, avg_edge_claimed_pct, top_categories, latest_example }
  }).sort((a, b) => b.count - a.count)
}

// Calibration stats — computed on the fly from resolved predictions
export function getCalibrationStats(): CalibrationStats {
  const predictions = getPredictions()
  const resolved = predictions.filter((p) => p.outcome !== undefined)

  // --- Realized ROI by claimed-edge bucket, and by ORIGIN strategy --------
  // Computed BEFORE the resolved-count gate below, on purpose: these should
  // show every LOGGED (actionable) prediction and how many have resolved —
  // "5 logged, 0 resolved yet" — not disappear entirely just because nothing
  // has settled. A brand-new strategy that hasn't had time to resolve a
  // single trade would otherwise show zero rows anywhere on the Predictions
  // page, indistinguishable from "isn't logging anything at all."
  //
  // Payoff per contract: win → (1 − entry), loss → −entry. ROI is
  // Σpayoff / Σcost, i.e. return per dollar actually risked. Computed purely
  // from predictions + outcomes (no settlements join) so it works in
  // dry-run, where nothing ever settles on Kalshi.
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

  // Entry price: prefer the recorded execution price; otherwise derive it
  // from market_price (YES ask, so a NO entry costs 1 − that). Module-scope
  // (not nested in computeRoiStats) so daysHeld and computeRoiStats agree on
  // exactly one definition of "entry."
  const entryOf = (p: Prediction) => p.execution_price ?? (p.direction === 'YES' ? p.market_price : 1 - p.market_price)

  // Market's implied P(YES) at prediction time. Prefer the MIDPOINT of a
  // captured two-sided quote — market_price alone is the YES ASK, biased
  // upward by half the spread, which hands Claude free advantage on every
  // observation if used as the market's own forecast. Hoisted to module
  // scope (not just used for the pooled market_brier below) so
  // computeGroupMarketBrier can share the exact same definition per-strategy.
  const marketProbOf = (p: Prediction): number | null => {
    if (p.market_yes_bid != null && p.market_yes_ask != null) {
      return (p.market_yes_bid + p.market_yes_ask) / 2
    }
    return null
  }
  const brierAgainst = (rows: Prediction[], probOf: (p: Prediction) => number) => {
    const sum = rows.reduce((acc, p) => {
      const actual = p.outcome === 'YES' ? 1 : 0
      return acc + Math.pow(probOf(p) - actual, 2)
    }, 0)
    return parseFloat((sum / rows.length).toFixed(4))
  }

  // Holding period in days for a RESOLVED row: created_at → the moment
  // capital was actually freed. For an early-exited position that's exit_ts
  // (the sale), NOT resolved_at — the market may settle long after the
  // position was already closed, and counting that dead time would
  // understate the strategy's true capital velocity. Held-to-resolution rows
  // use resolved_at, falling back to resolution_date for legacy rows that
  // predate that field. Floors at 1 so same-day resolution doesn't divide
  // toward infinity. null (fails closed, excluded from the per-dollar-day
  // metric only — never from hit rate/Brier/plain ROI) when neither end
  // timestamp parses.
  function daysHeld(p: Prediction): number | null {
    const startMs = Date.parse(p.created_at)
    if (!Number.isFinite(startMs)) return null
    const endIso = p.exited_early && p.exit_ts ? p.exit_ts : (p.resolved_at ?? p.resolution_date)
    if (!endIso) return null
    const endMs = Date.parse(endIso)
    if (!Number.isFinite(endMs)) return null
    const days = (endMs - startMs) / (1000 * 60 * 60 * 24)
    return Number.isFinite(days) ? Math.max(1, days) : null
  }

  // Realized cash payoff per contract, entry to exit. A position sold early
  // by the exit pass realized its proceeds AT THE SALE — whatever the
  // underlying market goes on to settle at afterward is no longer this
  // trade's economics, so exited_early rows use the recorded (fee-net)
  // exit_price instead of the resolution-implied win/loss payoff. Direction
  // correctness (hit_rate/Brier) still uses the eventual outcome — an early
  // exit doesn't change whether the CALL was right, only how much of the
  // move was captured.
  function payoffOf(p: Prediction, entry: number): number {
    if (p.exited_early && p.exit_price != null && Number.isFinite(p.exit_price)) {
      return p.exit_price - entry
    }
    return p.direction === p.outcome ? 1 - entry : -entry
  }

  // Shared by by_edge_bucket, by_strategy, and by_confidence below — the
  // exact same payoff math, computed once. Duplicating this a second time is
  // exactly how a fee/field bug independently recurs across call sites.
  function computeRoiStats(rows: Prediction[]): {
    resolved: number
    realized_roi_pct: number | null
    realized_roi_per_dollar_day: number | null
    hit_rate: number | null
    brier: number | null
  } {
    const settled = rows.filter((p) => p.outcome !== undefined)
    if (settled.length === 0) {
      return { resolved: 0, realized_roi_pct: null, realized_roi_per_dollar_day: null, hit_rate: null, brier: null }
    }
    const hit_rate = settled.filter((p) => p.direction === p.outcome).length / settled.length
    const brierSum = settled.reduce((s, p) => {
      const actual = p.outcome === 'YES' ? 1 : 0
      return s + Math.pow(p.predicted_probability - actual, 2)
    }, 0)
    const brier = parseFloat((brierSum / settled.length).toFixed(4))

    const priced = settled.filter((p) => {
      const entry = entryOf(p)
      return Number.isFinite(entry) && entry > 0 && entry < 1
    })
    let realized_roi_pct: number | null = null
    if (priced.length > 0) {
      let cost = 0
      let payoff = 0
      for (const p of priced) {
        const entry = entryOf(p)
        cost += entry
        payoff += payoffOf(p, entry)
      }
      realized_roi_pct = cost > 0 ? parseFloat(((payoff / cost) * 100).toFixed(1)) : null
    }

    // Same payoff math, denominated in capital-DAYS rather than capital
    // alone — a 3% edge resolving in 2 days and an 8% edge resolving in 60
    // days are not comparable on realized_roi_pct alone. Rows with no usable
    // holding-period timestamp are excluded from this sum only.
    let realized_roi_per_dollar_day: number | null = null
    {
      let costDays = 0
      let payoff = 0
      for (const p of priced) {
        const dh = daysHeld(p)
        if (dh == null) continue
        const entry = entryOf(p)
        costDays += entry * dh
        payoff += payoffOf(p, entry)
      }
      realized_roi_per_dollar_day = costDays > 0 ? parseFloat(((payoff / costDays) * 100).toFixed(3)) : null
    }

    return {
      resolved: settled.length,
      realized_roi_pct,
      realized_roi_per_dollar_day,
      hit_rate: parseFloat(hit_rate.toFixed(3)),
      brier,
    }
  }

  // Market's Brier score over one row group, same midpoint-preferred logic
  // as the pooled market_brier below — factored out so by_strategy can reuse
  // it instead of re-deriving the math a second time.
  function computeGroupMarketBrier(rows: Prediction[]): number | null {
    const settled = rows.filter((p) => p.outcome !== undefined)
    const withMidpoint = settled.filter((p) => marketProbOf(p) != null)
    if (withMidpoint.length > 0) return brierAgainst(withMidpoint, (p) => marketProbOf(p)!)
    const withMarketPrice = settled.filter((p) => p.market_price != null)
    if (withMarketPrice.length === 0) return null
    return brierAgainst(withMarketPrice, (p) => p.market_price)
  }

  const by_edge_bucket: EdgeBucketStats[] = EDGE_BUCKETS.map(({ label, min, max }) => {
    const inBucket = actionablePreds.filter((p) => p.edge_pct >= min && p.edge_pct < max)
    const roi = computeRoiStats(inBucket)
    return {
      bucket: label,
      count: inBucket.length,
      resolved: roi.resolved,
      claimed_edge_avg: inBucket.length > 0
        ? parseFloat((inBucket.reduce((s, p) => s + p.edge_pct, 0) / inBucket.length).toFixed(2))
        : 0,
      realized_roi_pct: roi.realized_roi_pct,
      realized_roi_per_dollar_day: roi.realized_roi_per_dollar_day,
      hit_rate: roi.hit_rate,
    }
  })

  // Realized ROI by ORIGIN strategy — the strategy-registry go/no-go
  // metric. Same actionable-only, same payoff math, grouped by `strategy`
  // instead of claimed edge. Legacy rows (no strategy tag) predate the
  // registry and were all the LLM scanner.
  const strategyNames = Array.from(
    new Set(actionablePreds.map((p) => p.strategy ?? 'llm-divergence'))
  ).sort()
  const by_strategy: StrategyStats[] = strategyNames.map((name) => {
    const inStrategy = actionablePreds.filter((p) => (p.strategy ?? 'llm-divergence') === name)
    const roi = computeRoiStats(inStrategy)
    return {
      strategy: name,
      count: inStrategy.length,
      resolved: roi.resolved,
      hit_rate: roi.hit_rate,
      realized_roi_pct: roi.realized_roi_pct,
      realized_roi_per_dollar_day: roi.realized_roi_per_dollar_day,
      brier: roi.brier,
      market_brier: computeGroupMarketBrier(inStrategy),
    }
  })

  // Realized ROI by the CONFIDENCE TIER that actually drove Kelly sizing —
  // only autopilot-sourced rows carry `confidence` (see AutopilotTrade →
  // createPrediction in autopilot.ts), so this is silently empty until that
  // wiring exists there; rows with no confidence tag are omitted, not
  // miscategorized into a bucket they were never tagged for.
  const CONFIDENCE_TIERS: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH']
  const by_confidence: ConfidenceTierStats[] = CONFIDENCE_TIERS
    .map((confidence) => {
      const inTier = actionablePreds.filter((p) => p.confidence === confidence)
      const roi = computeRoiStats(inTier)
      return {
        confidence,
        count: inTier.length,
        resolved: roi.resolved,
        hit_rate: roi.hit_rate,
        realized_roi_pct: roi.realized_roi_pct,
        brier: roi.brier,
      }
    })
    .filter((s) => s.count > 0)

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
    by_edge_bucket,
    market_brier_midpoint_samples: 0,
    by_strategy,
    by_mistake_type: computeMistakeTypeStats(),
    by_confidence,
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
  // Score the market at its MIDPOINT where a two-sided quote was captured —
  // fall back to ask-priced legacy rows only when no midpoint rows exist at
  // all, and report the sample count so the UI can flag a fallback
  // comparison as biased rather than presenting it as clean. (marketProbOf /
  // brierAgainst are defined once, above, and shared with computeGroupMarketBrier.)
  const resolvedWithMidpoint = resolved.filter((p) => marketProbOf(p) != null)
  const market_brier_midpoint_samples = resolvedWithMidpoint.length

  let market_brier: number | null = null
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
    by_strategy,
    by_mistake_type: computeMistakeTypeStats(),
    by_confidence,
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

// Ordered so a more specific pattern is checked before a more general one
// that could also match it (e.g. the cluster/daily-spend "would exceed"
// belt-and-braces re-checks share the word "exposure"/"spend" with their
// primary-check siblings, so distinctive phrases are matched as SUBSTRINGS,
// not prefixes — several skip messages interpolate a ticker/dollar value
// BEFORE the diagnostic phrase, so `.startsWith()` would silently miss them).
// Mirrors every skip()/informational-skip call site in autopilot.ts exactly.
const SKIP_REASON_CATEGORIES: Array<{ category: string; test: (reason: string) => boolean }> = [
  { category: 'Below min effective edge', test: (r) => r.startsWith('Effective edge') },
  { category: 'Below min confidence', test: (r) => r.startsWith('Confidence ') },
  { category: 'Category blacklisted', test: (r) => r.includes('is blacklisted') },
  { category: 'No/unverifiable resolution date', test: (r) => r.includes('cannot verify horizon') },
  { category: 'Beyond absolute horizon ceiling', test: (r) => r.includes('horizon ceiling') },
  { category: 'No valid execution price', test: (r) => r.includes('No valid execution price') || r.includes('outside valid 1') },
  { category: 'Already holding position (no averaging)', test: (r) => r.includes('Already holding a position') },
  { category: 'Just sold this cycle', test: (r) => r.includes('Just sold this position') },
  { category: 'Max open positions reached', test: (r) => r.startsWith('Open positions') },
  { category: 'Cluster exposure limit', test: (r) => r.includes('Cluster "') },
  { category: 'Daily spend limit', test: (r) => r.includes('Daily spend') },
  { category: 'Total exposure limit', test: (r) => r.includes('Total exposure') },
  { category: 'Kelly non-positive after haircut', test: (r) => r.includes('Kelly criterion is non-positive') },
  { category: 'Stake buys < 1 contract', test: (r) => r.includes('buys less than 1 contract') },
  { category: 'Insufficient balance', test: (r) => r.includes('Insufficient balance') },
  { category: 'Maker mode: no live bid to rest on', test: (r) => r.includes('Maker mode: no live bid') },
  { category: 'Exit: no live quote/bid', test: (r) => r.includes('Could not fetch live quote') || r.includes('No live bid to sell into') },
  { category: 'Exit check failed', test: (r) => r.includes('Exit check failed') },
  { category: 'Go-live calibration gate', test: (r) => r.includes('Live trading gate not met') },
  { category: 'Near miss (informational, zero-buy cycles only)', test: (r) => r.startsWith('Near miss') },
]

// Which guardrail actually binds — computed from EVERY skip logged in
// autopilot_log.json (all trades carrying a skip_reason, across every run
// still in the retention window), plus the tier-1 (pre-guardrail) rejection
// count each run now records unconditionally. Answers "is the edge gate
// starving the funnel, or is nothing even reaching it" as a measured number
// instead of arithmetic on the min_effective_edge/shrinkage formula.
export function getAutopilotFunnelStats(): AutopilotFunnelStats {
  const runs = getAutopilotRuns()
  const counts = new Map<string, number>()
  let total_skips = 0
  let total_tier1_screened_out = 0

  for (const run of runs) {
    total_tier1_screened_out += run.opportunities_screened_out ?? 0
    for (const t of run.trades) {
      if (!t.skip_reason) continue
      total_skips++
      const match = SKIP_REASON_CATEGORIES.find((c) => c.test(t.skip_reason!))
      const category = match?.category ?? 'Other'
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }

  const by_reason: SkipReasonStats[] = Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)

  return { total_skips, total_tier1_screened_out, by_reason }
}
