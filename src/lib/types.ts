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
  source: 'scanner' | 'analyze' | 'manual'
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

export interface AppSettings {
  anthropic_api_key: string
  kalshi_api_key: string       // RSA key ID (UUID from Kalshi dashboard)
  kalshi_private_key: string   // RSA private key PEM (-----BEGIN PRIVATE KEY-----)
  tavily_api_key: string       // Tavily AI Search (free tier: 1000 searches/month)
  min_edge_threshold: number   // default 0.03
  max_position_pct: number     // default 0.05
  max_corr_exposure_pct: number // default 0.15
  default_kelly_fraction: 'low' | 'medium' | 'high'
  use_extended_thinking: boolean // effort 'max' (true) vs 'high' (false) on claude-opus-4-7
}

export interface CalibrationStats {
  total_predictions: number
  resolved_predictions: number
  overall_accuracy: number      // fraction where bet direction matched outcome
  brier_score: number           // lower is better; 0.25 = random; 0 = perfect
  yes_bias: number              // positive = over-predicts YES; negative = over-predicts NO
  recent_accuracy: number       // accuracy on last 10 resolved predictions
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
