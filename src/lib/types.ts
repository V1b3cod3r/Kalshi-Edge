export interface MacroView {
  id: string
  thesis: string
  direction: string
  conviction: 'LOW' | 'MEDIUM' | 'HIGH'
  timeframe: string // "through YYYY-MM-DD"
  affects_category: string
  affects_keywords: string[]
  p_implied: number | null // 0-1
  notes: string
  created_at: string
  updated_at: string
}

export interface Position {
  id: string
  market: string
  direction: 'YES' | 'NO'
  contracts: number
  avg_price: number
  current_price: number
  category: string
  corr_group: string
}

export interface SessionState {
  current_bankroll: number
  starting_bankroll: number
  positions: Position[]
  corr_groups: Record<string, { total_notional: number; pct_of_bankroll: number; cap_remaining: number }>
  recent_win_rate: number
  kelly_modifier: number
  avoid_categories: string[]
  max_new_positions: number
}

export interface Prediction {
  id: string
  market_title: string
  ticker?: string
  category: string
  predicted_probability: number  // Claude's YES probability (0-1)
  direction: 'YES' | 'NO'        // Claude's recommended bet direction
  market_price: number           // market YES price at time (0-1)
  edge_pct: number               // claimed edge percentage
  resolution_date?: string
  created_at: string
  resolved_at?: string
  outcome?: 'YES' | 'NO'        // actual market outcome
  notes?: string
  source: 'scanner' | 'analyze' | 'manual' | 'autopilot'
  lesson_id?: string             // set after lesson extracted for a wrong prediction

  // --- Calibration-integrity fields (added to fix selection bias) -----------
  // false = evaluated but did NOT clear the edge filter. Logging ONLY
  // actionable rows meant the Claude-vs-market comparison was computed on a
  // sample selected by the very disagreement it was trying to validate, so a
  // zero-skill model still looked distinctive. Legacy rows have this
  // undefined and are treated as `true` (all pre-fix rows were actionable).
  actionable?: boolean
  // Raw two-sided quote at prediction time. market_price above is the YES ASK,
  // which handicaps the market baseline by half the spread on every
  // observation; the midpoint of these two is the fair comparison price.
  market_yes_bid?: number
  market_yes_ask?: number
  // Price actually paid per contract for the recommended side (YES ask for a
  // YES call, NO ask for a NO call). Enables realized-ROI-per-edge-bucket
  // without a settlements join — which matters because dry-run predictions
  // never settle on Kalshi and would otherwise be invisible.
  execution_price?: number
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH'
  // Which strategy produced this prediction — 'llm-divergence' |
  // 'dated-favorites' | 'settlement-snipe' | ... Undefined on legacy rows
  // (all pre-registry rows were the LLM scanner). The entire mechanism
  // behind per-strategy P&L attribution — see getCalibrationStats'
  // by_strategy breakdown and docs/STRATEGY_EXPANSION_PLAN.md.
  strategy?: string
  // Kelly sizing inputs actually used at trade time (autopilot only) — what
  // confidence-tier haircut and fraction-of-full-Kelly produced kelly_stake.
  // Without these, the 3/5/8pp haircut tiers can never be validated against
  // realized outcomes, and it's invisible that two tiers are dead code
  // whenever min_confidence is set to HIGH (see autopilot.ts evaluateOpportunity).
  haircut_pp_applied?: number
  kelly_fraction_used?: number

  // --- Exit tracking (added so early exits aren't silently scored as if
  // held to resolution) -------------------------------------------------
  // true when this position was sold early by the autopilot exit pass
  // rather than settled by Kalshi at resolution. Without this, computeRoiStats
  // treats every resolved row identically — an early sale at 70c looks the
  // same as holding to a 100c settlement, silently corrupting the very ROI
  // numbers that would otherwise validate or refute the exit policy.
  exited_early?: boolean
  exit_price?: number   // dollars per contract, net of the sell fee
  exit_ts?: string
  exit_reason?: string  // e.g. 'take_profit' — mirrors AutopilotTrade.exit_reason
}

// Realized performance grouped by the edge we CLAIMED at entry. This is the
// metric that decides whether to trade at all: "when we claimed 4-6% edge,
// what did we actually earn per dollar risked?" Brier measures probabilistic
// calibration, which can improve while losing money.
export interface EdgeBucketStats {
  bucket: string                    // '0-2%', '2-4%', '4-6%', '6-10%', '10%+'
  count: number                     // actionable predictions in this bucket
  resolved: number                  // of those, how many have settled
  claimed_edge_avg: number          // mean claimed edge (pp)
  realized_roi_pct: number | null   // Σ payoff / Σ cost × 100; null until resolved > 0
  hit_rate: number | null           // fraction where direction was correct
  // Σ payoff / Σ (cost × days held) × 100 — see StrategyStats.realized_roi_per_dollar_day.
  realized_roi_per_dollar_day: number | null
}

// Realized performance grouped by ORIGIN strategy — the entire point of the
// strategy registry (docs/STRATEGY_EXPANSION_PLAN.md). "Which of my edges
// actually earns money" answered as a GROUP BY over data that already
// exists, not a separate subsystem.
export interface StrategyStats {
  strategy: string                  // 'llm-divergence' | 'dated-favorites' | 'settlement-snipe' | ...
  count: number                     // actionable predictions from this strategy
  resolved: number                  // of those, how many have settled
  hit_rate: number | null
  realized_roi_pct: number | null   // Σ payoff / Σ cost × 100; null until resolved > 0
  brier: number | null              // resolved-only; null until resolved > 0
  // Market's Brier score over this strategy's OWN resolved rows, computed the
  // same midpoint-preferred way as the pooled market_brier. Without this, the
  // go-live gate could only ever compare a strategy's Brier against nothing
  // strategy-specific — see require_calibration_to_go_live in autopilot.ts.
  market_brier: number | null
  // Σ payoff / Σ (cost × days held), ×100. Same payoff math as
  // realized_roi_pct but denominated in capital-days rather than capital
  // alone — a 3% edge resolving in 2 days and an 8% edge resolving in 60
  // days are NOT comparable on realized_roi_pct alone. null until at least
  // one resolved row has a usable days-held figure (resolved_at present and
  // parseable; falls back to resolution_date).
  realized_roi_per_dollar_day: number | null
}

// Realized performance grouped by the CONFIDENCE TIER Claude/the strategy
// reported at trade time — the tier that actually drove the Kelly haircut
// (kelly_haircut_high_pp / _medium_pp / _low_pp in AutopilotSettings). Exists
// because two of those three haircut tiers are unreachable whenever
// min_confidence is 'HIGH' (the shipped default) — see the comment at
// evaluateOpportunity's Kelly block in autopilot.ts — and nothing else
// records which tier actually produced a given stake.
export interface ConfidenceTierStats {
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  count: number
  resolved: number
  hit_rate: number | null
  realized_roi_pct: number | null
  brier: number | null
}

export type MistakeType = 'overconfidence' | 'base_rate_neglect' | 'anchoring' | 'news_overreaction' | 'thin_market' | 'timing_error' | 'other'

export interface Lesson {
  id: string
  prediction_id: string
  market_title: string
  category: string
  keywords: string[]             // extracted from market title for future matching
  predicted_direction: 'YES' | 'NO'
  actual_outcome: 'YES' | 'NO'
  predicted_probability: number  // Claude's P(YES) 0-1
  market_price: number           // market P(YES) at time of bet 0-1
  edge_pct: number
  what_went_wrong: string        // 1-2 sentence post-mortem
  what_to_do_differently: string // actionable recommendation
  mistake_type: MistakeType
  created_at: string
  // Which strategy produced the losing prediction — undefined on legacy rows
  // (pre-dates this field; treated as 'llm-divergence', same convention as
  // Prediction.strategy). Matters because only llm-divergence losses are
  // genuine REASONING-error postmortems — a mechanical strategy's loss is
  // expected variance around a documented, deliberately-conservative model,
  // not a diagnosable mistake the LLM scanner could learn from. See
  // getRelevantLessons in storage.ts, which excludes non-LLM-origin lessons
  // from the scanner-facing lookup for this reason.
  strategy?: string
}

// Aggregated view over every extracted lesson, grouped by WHY the trade lost
// — the thing a per-loss lesson answers individually but nothing previously
// rolled up. Answers "which failure mode actually recurs" so a pattern (e.g.
// overconfidence concentrated in one category) is visible without reading
// every lesson by hand.
export interface MistakeTypeStats {
  mistake_type: MistakeType
  count: number                    // lessons tagged with this mistake type
  avg_edge_claimed_pct: number     // mean claimed edge on the losing trades behind these lessons
  top_categories: string[]         // up to 3 categories, most frequent first
  latest_example: string | null    // most recent what_to_do_differently, for a quick read
}

export interface AutopilotSettings {
  enabled: boolean                 // master switch, default false
  dry_run: boolean                 // default true — log decisions, place NO orders
  min_effective_edge_pct: number   // default 15 — set at the measured calibration floor, see scan.ts MIN_EFFECTIVE_EDGE
  min_confidence: 'MEDIUM' | 'HIGH' // default 'HIGH'
  max_per_trade_usd: number        // default 25
  max_daily_spend_usd: number      // default 100
  max_daily_loss_usd: number       // default 50 — halt if realized losses today exceed this
  max_open_positions: number       // default 10
  max_exposure_usd: number         // default 250 — total cost basis of open positions
  kelly_fraction: number           // default 0.25 (quarter-Kelly)
  category_blacklist: string[]     // default ['Sports']
  max_per_cluster_usd: number      // default 50 — correlation cluster cap
  scan_limit: number               // default 40 — how many markets each cycle analyzes (breadth, not risk)
  // default false — a live-money study found stop-losses and take-profits
  // both destroyed value vs. hold-to-resolution on binary contracts. See
  // DEFAULT_AUTOPILOT in storage.ts for the full reasoning.
  exit_enabled: boolean
  take_profit_pct: number          // default 40 — sell when position up >= this % of entry cost
  max_days_to_resolution: number   // default 45 — skip markets resolving further out than this (capital velocity + faster calibration feedback)
  min_resolved_predictions_for_live: number // default 30 — live orders blocked until this many predictions have resolved AND Claude beats the market's Brier score on this history
  // default false — at the user's explicit request, live trading is NOT
  // gated on calibration history. When true, restores the check above.
  // NOTE: with this off, autopilot can place real orders with zero evidence
  // it has any edge over the market. Left as a setting (not deleted) so it
  // can be turned back on without reconstructing the logic.
  require_calibration_to_go_live: boolean
  // Kelly assumes p is the TRUE probability; ours is an LLM estimate blended
  // with a market price, carrying substantial unquantified error — and Kelly
  // is hypersensitive to error in p (overestimating by a few points turns
  // quarter-Kelly into effectively over-levered). Size from a conservative
  // LOWER BOUND on p instead, haircut by Claude's own stated confidence.
  // Percentage points subtracted from the win probability before sizing.
  // NOTE: which of these three tiers is reachable depends on min_confidence.
  // At the shipped default (min_confidence 'HIGH'), only the HIGH tier's
  // haircut was reachable at all — MEDIUM/LOW opportunities never passed the
  // confidence filter to reach the Kelly block in the first place. autopilot.ts
  // now also applies a track-record-aware cap (a strategy with no resolved
  // sample of its own gets treated as MEDIUM regardless of its self-reported
  // confidence), which exercises the MEDIUM tier for a brand-new deployment —
  // but a long-proven strategy that only ever self-reports HIGH still never
  // exercises LOW, and never exercises MEDIUM either once proven.
  kelly_haircut_high_pp: number    // default 3
  kelly_haircut_medium_pp: number  // default 5
  kelly_haircut_low_pp: number     // default 8
  // default false (opt-in). When true, BUY orders rest at the current bid as
  // post_only (maker) instead of crossing at the ask as immediate_or_cancel
  // (taker) — Kalshi's maker fee is 1/4 the taker fee (or zero on some
  // series). Off by default because it changes fill behavior: a maker order
  // can go unfilled and expire (see MAKER_ORDER_EXPIRATION_SECONDS in
  // autopilot.ts) rather than filling immediately, so it trades fee savings
  // for fill-rate uncertainty. Sell/exit orders always stay taker — a timely
  // exit matters more there than the fee difference.
  // SCOPE NOTE: this only changes the PRICE PAID at execution — autopilot.ts
  // reprices to the live bid AFTER evaluateOpportunity has already decided to
  // trade and sized the stake. It never changes which opportunities clear the
  // effective-edge bar or how big a stake is: the fee coefficient feeding
  // edge screening and Kelly sizing (scan.ts kalshiFeeCoef) is always the
  // TAKER rate, maker or not. "Cuts the fee 4x" describes execution cost, not
  // new marginal trades unlocked.
  use_maker_orders: boolean

  // --- Strategy registry (see docs/STRATEGY_EXPANSION_PLAN.md) -------------
  // Every strategy funnels through the SAME guardrail/Kelly/logging pipeline
  // below, tagged by name — the tag is what makes per-strategy P&L
  // attribution possible in getCalibrationStats' by_strategy breakdown.

  // default true — the original LLM-divergence scanner, formalized as one
  // registry entry rather than special-cased. Nothing about running it
  // changes; this toggle exists so it can be turned OFF to run only the
  // mechanical strategies below, e.g. while validating them independently.
  strategy_llm_divergence_enabled: boolean
  // default false (opt-in, brand new, unvalidated in production). Mechanical
  // price × horizon rule — see datedFavorites.ts. No LLM call.
  strategy_dated_favorites_enabled: boolean
  dated_favorites_min_price_cents: number // default 65
  dated_favorites_max_price_cents: number // default 90
  dated_favorites_min_days: number        // default 14
  dated_favorites_max_days: number        // default 56
  // default 500 (matches the manual scanner's own THIN-market threshold —
  // see prompts.ts). This strategy unconditionally reports confidence HIGH
  // regardless of liquidity (see its own "reported HIGH so it can actually
  // clear the default min_confidence gate" comment) — a thin, single-quote
  // market otherwise draws the SAME (smallest) Kelly haircut as a liquid one.
  // Autopilot's llm-divergence path has its own volume filter explicitly
  // disabled (min_volume: 0 in autopilot.ts), so this is the only operative
  // liquidity floor across any autopilot-invoked strategy.
  dated_favorites_min_volume_usd: number
  // default false (opt-in, brand new, unvalidated in production). Live
  // weather-observation-vs-strike rule — see settlementSnipe.ts. No LLM call.
  strategy_settlement_snipe_enabled: boolean
  settlement_snipe_margin_f: number            // default 2 — required °F cushion before firing
  settlement_snipe_max_confidence_pct: number  // default 95 — hard cap on the reported probability
}

export interface AppSettings {
  anthropic_api_key: string
  kalshi_api_key: string       // RSA key ID (UUID from Kalshi dashboard)
  kalshi_private_key: string   // RSA private key PEM (-----BEGIN PRIVATE KEY-----)
  tavily_api_key: string       // Tavily AI Search (free tier: 1000 searches/month)
  min_edge_threshold: number   // default 0.03
  max_position_pct: number     // default 0.05
  max_corr_exposure_pct: number // default 0.15
  default_kelly_fraction: 'low' | 'medium' | 'high'
  use_extended_thinking: boolean // effort 'max' (true) vs 'high' (false) on claude-opus-4-8
  // Model for the breadth scanner (scanner page + autopilot cycles). Deep
  // single-market analysis always uses Opus 4.8 regardless of this setting.
  // 'claude-sonnet-5' ≈ 2.5x cheaper per token; 'claude-opus-4-8' = max quality.
  scanner_model: 'claude-sonnet-5' | 'claude-opus-4-8'
  autopilot: AutopilotSettings
}

// One trade decision (executed, dry-run, or skipped) within an autopilot cycle
export interface AutopilotTrade {
  ticker: string
  title?: string
  side: 'yes' | 'no'
  contracts: number
  price: number              // execution price in dollars (0–1)
  cost: number               // contracts × price, dollars
  effective_edge_pct: number
  kelly_stake: number        // dollars, after fraction + clamps
  executed: boolean
  order_id?: string
  skip_reason?: string
  intent?: 'buy' | 'sell'    // default 'buy' when absent (back-compat)
  exit_reason?: string       // 'take_profit' human text, set on sells
  // Which strategy produced this trade — 'llm-divergence' | 'dated-favorites'
  // | 'settlement-snipe' | 'exit-management' (sells) | undefined (legacy
  // rows, all pre-registry rows were the LLM scanner).
  strategy?: string
  // Why the strategy flagged this opportunity — carried through from
  // StrategyOpportunity.rationale unchanged. Present on buys and their skips
  // (the same opportunity, evaluated); absent on sells, which already have
  // exit_reason for their (purely mechanical) reasoning.
  rationale?: string
  // Confidence tier and the Kelly inputs it drove — see Prediction's fields
  // of the same name for why these matter. Present on sized buys/skips only
  // (sells have no confidence tier — the exit pass is pure price mechanics).
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH'
  haircut_pp_applied?: number
  kelly_fraction_used?: number
  // 'maker' when placed as a resting post_only order (use_maker_orders),
  // 'taker' when crossing the spread immediate_or_cancel. Undefined on sells
  // (exit orders always taker — see the exit pass) and on skips (never placed).
  order_type?: 'maker' | 'taker'
}

export interface AutopilotRun {
  id: string
  started_at: string
  finished_at: string
  status: 'ok' | 'disabled' | 'halted' | 'error'
  dry_run: boolean
  markets_scanned: number
  opportunities_considered: number
  trades: AutopilotTrade[]
  halted?: string            // circuit-breaker / halt reason
  error?: string
  // Snapshot of the setting at run time — lets a skip-reason/funnel analysis
  // (see storage.ts getAutopilotFunnelStats) distinguish "maker mode was off"
  // from "maker mode was on but found no bid" without re-reading settings
  // history that may have since changed.
  use_maker_orders?: boolean
  // How many llm-divergence candidates Claude/code screened out BEFORE the
  // guardrail pipeline ever saw them (scan.ts's screened_out list — ticker
  // mismatches, below-effective-edge, and Claude's own fairly-priced calls).
  // Recorded unconditionally every cycle, not just when it's the only output
  // to show — the near-miss entries already logged into `trades` are capped
  // at 5 and only appear on a zero-buy cycle, so this is the only place the
  // TRUE count survives for funnel analysis.
  opportunities_screened_out?: number
}

export interface CalibrationStats {
  total_predictions: number
  resolved_predictions: number
  overall_accuracy: number      // fraction where bet direction matched outcome
  brier_score: number           // lower is better; 0.25 = random; 0 = perfect
  yes_bias: number              // mean predicted P(YES) minus observed YES rate; positive = over-predicts YES
  recent_accuracy: number       // accuracy on last 10 resolved predictions
  recent_win_rate: number | null // null when fewer than 10 resolved predictions (insufficient data)
  claude_brier: number          // alias for brier_score, explicit label
  market_brier: number | null   // market's Brier score over same resolved predictions; null if no market_price data
  claude_vs_market: string      // human-readable comparison string
  by_source: {
    scanner: { count: number; brier: number | null; win_rate: number | null }
    analyze: { count: number; brier: number | null; win_rate: number | null }
  }
  by_category: Record<string, { predictions: number; accuracy: number; brier: number }>
  // Realized P&L grouped by claimed edge — the primary go/no-go metric.
  by_edge_bucket: EdgeBucketStats[]
  // How many resolved rows carried a two-sided quote (and so could be scored
  // against the market MIDPOINT). When 0, market_brier fell back to the
  // ask-priced legacy baseline and the comparison is biased toward Claude.
  market_brier_midpoint_samples: number
  // Realized P&L grouped by ORIGIN strategy — see StrategyStats.
  by_strategy: StrategyStats[]
  // Every extracted lesson grouped by WHY the trade lost — see
  // MistakeTypeStats. Sorted most-frequent first so the top row is always
  // "the failure mode costing the most trades right now."
  by_mistake_type: MistakeTypeStats[]
  // Realized P&L grouped by the CONFIDENCE TIER that drove sizing at trade
  // time — see ConfidenceTierStats. Only populated for autopilot-sourced
  // rows carrying the confidence field (older/manual rows are omitted, not
  // miscategorized).
  by_confidence: ConfidenceTierStats[]
}

// One bucket of the skip-reason funnel — see getAutopilotFunnelStats in
// storage.ts. Computed from autopilot_log.json (not predictions.json), so it
// lives outside CalibrationStats: it answers "which guardrail actually binds"
// across every skip ever logged, not "did the model call the outcome right."
export interface SkipReasonStats {
  category: string   // human-readable bucket label, e.g. "Below min effective edge"
  count: number
}

export interface AutopilotFunnelStats {
  total_skips: number
  total_tier1_screened_out: number   // Σ opportunities_screened_out across runs
  by_reason: SkipReasonStats[]       // sorted most-frequent first
}

export interface MarketInput {
  id?: string
  title: string
  resolution_criteria?: string
  resolution_date?: string
  yes_price: number   // YES ASK — the price a YES buyer pays
  no_price: number    // NO ASK — the price a NO buyer pays
  // Raw quote sides, retained so calibration can score the market at its
  // MIDPOINT rather than at the ask (scoring at the ask hands Claude half the
  // spread as free advantage on every observation).
  yes_bid?: number
  yes_ask?: number
  volume_24h?: number
  category?: string
  corr_group?: string
  // Kalshi groups markets under an event; markets sharing an event_ticker are
  // near-perfectly correlated. Preferred over ticker-prefix string matching
  // for correlation-cluster caps. Optional: presence on the markets response
  // is not guaranteed, so consumers must fall back.
  event_ticker?: string
}

export interface AnalysisResult {
  market_id?: string
  title: string
  p_data: number
  p_blended: number
  views_applied: string[]
  edge_direction: 'YES' | 'NO'
  edge_magnitude: number
  kelly_full: number
  recommended_size_pct: number
  recommended_size_dollars: number
  trade_classification: 'DATA-DRIVEN' | 'BLENDED' | 'VIEW-DRIVEN'
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  action: 'BET' | 'NO_BET'
  flag: string | null
  reasoning: string // full markdown analysis from Claude
}
