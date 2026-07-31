// Common shape every strategy emits — the LLM-divergence scanner, dated
// favorites, settlement sniping, and any future strategy all funnel through
// the SAME evaluateOpportunity guardrail/Kelly path in autopilot.ts. This is
// deliberately close to ScanOpportunity's shape so that adapter is nearly a
// no-op; the one addition that matters is `strategy`, which is the entire
// mechanism for per-strategy P&L attribution — tag it once here, and it
// carries through to AutopilotTrade and Prediction with no separate tracking
// system.
export interface StrategyOpportunity {
  strategy: string            // 'llm-divergence' | 'dated-favorites' | 'settlement-snipe' | ...
  ticker: string
  title: string
  direction: 'YES' | 'NO'
  execution_price: number     // ask price for the recommended side, 0-1
  edge_pct: number            // effective edge after fees, percent — same scale as min_effective_edge_pct
  p_shrunk: number            // P(YES) used for Kelly sizing, 0-1 (mirrors ScanOpportunity.p_shrunk)
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  category: string
  resolution_date: string | null
  rationale: string
  // P(YES) BEFORE shrinkage toward the market price — only meaningful for the
  // llm-divergence strategy (Claude's raw self-report). Mechanical strategies
  // leave this unset; their p_shrunk IS the belief, there's no separate "raw"
  // number to distinguish. Logged to Prediction.predicted_probability instead
  // of p_shrunk when present, so calibration measures CLAUDE's calibration,
  // not the blended trading decision — see STRATEGY_PLAN.md Phase 1.
  raw_probability?: number
}
