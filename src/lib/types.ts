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
}

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
  mistake_type: 'overconfidence' | 'base_rate_neglect' | 'anchoring' | 'news_overreaction' | 'thin_market' | 'timing_error' | 'other'
  created_at: string
}

export interface AutopilotSettings {
  enabled: boolean                 // master switch, default false
  dry_run: boolean                 // default true — log decisions, place NO orders
  min_effective_edge_pct: number   // default 7
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
  exit_enabled: boolean            // default true — manage open positions each cycle
  take_profit_pct: number          // default 40 — sell when position up >= this % of entry cost
  stop_loss_pct: number            // default 50 — sell when position down >= this % of entry cost
  max_days_to_resolution: number   // default 45 — skip markets resolving further out than this (capital velocity + faster calibration feedback)
  min_resolved_predictions_for_live: number // default 30 — live orders blocked until this many predictions have resolved AND Claude beats the market's Brier score on this history
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
  exit_reason?: string       // 'take_profit' | 'stop_loss' human text, set on sells
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
}

export interface MarketInput {
  id?: string
  title: string
  resolution_criteria?: string
  resolution_date?: string
  yes_price: number
  no_price: number
  volume_24h?: number
  category?: string
  corr_group?: string
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
