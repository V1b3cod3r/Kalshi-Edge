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

export interface AppSettings {
  anthropic_api_key: string
  kalshi_api_key: string
  min_edge_threshold: number // default 0.03
  max_position_pct: number // default 0.05
  max_corr_exposure_pct: number // default 0.15
  default_kelly_fraction: 'low' | 'medium' | 'high'
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
