import {
  getSettings,
  getAutopilotRuns,
  appendAutopilotRun,
  createPrediction,
  getPredictions,
  updatePrediction,
  getCalibrationStats,
} from '@/lib/storage'
import {
  placeOrder,
  fetchMarket,
  getPortfolioBalance,
  getPortfolioPositions,
  getPortfolioSettlements,
  getOpenOrders,
  cancelOrder,
  positionSignedQuantity,
  positionCostBasisDollars,
  settlementProfitDollars,
  KalshiAuth,
} from '@/lib/kalshi'
import { runScan, kalshiFeeCoef } from '@/lib/scan'
import { AutopilotRun, AutopilotTrade, StrategyStats } from '@/lib/types'
import { StrategyOpportunity } from '@/lib/strategies/types'
import { datedFavoritesOpportunities } from '@/lib/strategies/datedFavorites'
import { settlementSnipeOpportunities } from '@/lib/strategies/settlementSnipe'

// ---------------------------------------------------------------------------
// Autopilot: nearly-autonomous trade execution with hard, code-enforced
// guardrails. Every dollar figure in this module is in DOLLARS; conversion to
// cents happens only at the Kalshi API boundary (placeOrder price_cents).
// Fail-safe philosophy: any uncertainty (missing price, stale data, parse
// failure) → skip, never trade. Order errors abort the cycle, never retry.
// ---------------------------------------------------------------------------

export interface AutopilotReport extends AutopilotRun {}

// Hard, non-configurable ceiling on how far out a market can resolve and
// still be tradeable — applied to every strategy in evaluateOpportunity, on
// top of (not instead of) each strategy's own tunable horizon. See the
// guardrail comment at its use site for why this can't just be
// max_days_to_resolution (that setting is llm-divergence-specific).
const ABSOLUTE_MAX_DAYS_TO_RESOLUTION = 365

const CONFIDENCE_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

// Semantic correlation clusters — markets in the same cluster tend to resolve
// on the same underlying event, so we cap combined cost basis per cluster.
// Kept in sync with scan.ts's mapCategory, which recognizes the same topics
// under a materially wider term list — a market miscategorized here isn't
// compared against its actually-correlated siblings for max_per_cluster_usd
// purposes at all (e.g. a GDP-contraction market and a Fed-rate-cut market
// each independently accumulating up to max_per_cluster_usd, both trading
// the same recession narrative, without the cap ever comparing them).
// Purely additive: widening a correlation cap only ever tightens sizing —
// it moves markets INTO a shared cap, never out of one.
const CLUSTER_KEYWORDS: Array<{ cluster: string; keywords: string[] }> = [
  { cluster: 'macro-rates', keywords: ['rates', 'fed', 'cpi', 'inflation', 'fomc', 'interest rate', 'gdp', 'jobless', 'unemployment', 'payroll', 'mortgage', 'treasury', 'recession'] },
  { cluster: 'crypto', keywords: ['btc', 'eth', 'sol', 'crypto', 'bitcoin', 'ethereum', 'solana'] },
  { cluster: 'equities', keywords: ['s&p', 'nasdaq', 'inx', 'dow jones', 'stock'] },
  { cluster: 'politics', keywords: ['trump', 'election', 'senate', 'congress', 'biden', 'harris', 'president', 'governor', 'shutdown', 'tariff', 'impeach', 'supreme court', 'white house'] },
  { cluster: 'weather', keywords: ['temperature', 'rain', 'snow', 'weather'] },
]

// Kalshi tickers are structured `{event_ticker}-{strike}`, e.g.
// KXTEMPNYCH-26JUL1207-T74.99 belongs to event KXTEMPNYCH-26JUL1207. Markets
// in the same event are near-perfectly correlated (different strikes on ONE
// underlying question), so the event is the right correlation unit.
//
// Deriving it from the ticker rather than reading an API field is deliberate:
// the field isn't guaranteed present on every response shape, and — more
// importantly — the cluster key must be computed IDENTICALLY for existing
// Kalshi positions and for new scan opportunities, or the exposure caps
// silently compare two different keyspaces and never bind.
export function eventKeyFromTicker(ticker: string): string | null {
  const parts = String(ticker).split('-')
  if (parts.length < 2) return null
  return parts.slice(0, -1).join('-').toUpperCase()
}

export function clusterForTicker(ticker: string, title?: string): string {
  const haystack = `${ticker} ${title ?? ''}`.toLowerCase()
  // Keyword clusters first: they capture CROSS-event correlation (every rates
  // market moves together regardless of event), which is broader than an
  // event and therefore the more conservative cap.
  for (const { cluster, keywords } of CLUSTER_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return cluster
  }
  // Then the event — far tighter than the old 4-char prefix fallback, which
  // let several strikes on the same question count as independent positions.
  const eventKey = eventKeyFromTicker(ticker)
  if (eventKey) return `evt:${eventKey}`
  return ticker.slice(0, 4).toUpperCase()
}

// TAKER orders are priced at the current ask expecting an immediate fill —
// 60s is generous headroom for that, not a resting window. Anything still
// open after this either filled seconds ago (harmless no-op cancel) or the
// price moved away, in which case it should never sit forever silently
// consuming spend/exposure headroom.
const ORDER_EXPIRATION_SECONDS = 60

// MAKER (post_only) orders are meant to rest — that's the whole point, it's
// how they earn the maker fee instead of the taker fee. This bounds how long,
// so an order that never becomes marketable doesn't tie up spend/exposure
// headroom indefinitely. 10 minutes is a deliberately short "lean" window:
// long enough to catch a normal price wobble, short enough that headroom
// self-corrects within roughly one cycle if it never fills.
const MAKER_ORDER_EXPIRATION_SECONDS = 600

// Reconciliation safety net: cancel any order still resting from a prior
// cycle (crash, timeout, expiration_ts not honored by an older order) before
// this cycle's balance/exposure snapshot is taken. Best-effort — a failure
// here must never block the cycle; the exit pass and guardrails already
// protect capital even if a stray order lingers. Cutoff is set past the
// maker expiration window so a legitimately-still-resting maker order isn't
// cancelled early — Kalshi's own expiration_time is the primary bound;
// this is the belt-and-suspenders backstop for orders it doesn't honor.
async function reconcileStaleOrders(auth: KalshiAuth): Promise<void> {
  try {
    const orders = await getOpenOrders(auth)
    const staleCutoffMs = Date.now() - (MAKER_ORDER_EXPIRATION_SECONDS + 5 * 60) * 1000
    for (const o of orders) {
      const createdMs = Date.parse(o.created_time ?? '')
      if (Number.isFinite(createdMs) && createdMs > staleCutoffMs) continue
      try {
        await cancelOrder(auth, o.order_id)
      } catch {
        // one stuck order must never block reconciliation of the rest
      }
    }
  } catch {
    // reconciliation is hygiene, not correctness — never abort the cycle
  }
}

// Parse a BID price from a Kalshi market object into decimal dollars (what you
// can SELL into immediately). Mirrors scan.ts's price-field fallback but for the
// bid: prefer the *_dollars field; the plain field is integer cents in v2, so a
// raw value ≥ 1 means cents → /100. Sub-1 plain values are legacy dollars.
function bidPrice(dollarsV: any, centsV: any): number {
  if (dollarsV != null && Number(dollarsV) > 0) return Number(dollarsV)
  const c = centsV == null ? 0 : Number(centsV)
  if (!c || c <= 0) return 0
  return c >= 1 ? c / 100 : c
}

function utcDay(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  return new Date(ts).toISOString().slice(0, 10)
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// Dollars spent by autopilot on EXECUTED trades today (from the run log).
// Dry-run trades and skips never count.
export function getTodaySpend(): number {
  const today = todayUtc()
  let spend = 0
  for (const run of getAutopilotRuns()) {
    if (utcDay(run.started_at) !== today) continue
    for (const t of run.trades) {
      if (t.executed) spend += t.cost
    }
  }
  return spend
}

// Realized P&L today from Kalshi settlements, in dollars (profit is reported
// by Kalshi in cents).
export function realizedPnlTodayFromSettlements(settlementsData: any): number {
  const today = todayUtc()
  const settlements: any[] = settlementsData?.settlements ?? []
  let pnl = 0
  for (const s of settlements) {
    const settledAt = s.settled_time ?? s.created_time ?? ''
    if (utcDay(settledAt) !== today) continue
    pnl += settlementProfitDollars(s)
  }
  return pnl
}

export async function runAutopilotCycle(): Promise<AutopilotReport> {
  const startedAt = new Date().toISOString()
  const settings = getSettings()
  const ap = settings.autopilot

  const baseReport = (): AutopilotReport => ({
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: 'ok',
    dry_run: ap.dry_run,
    markets_scanned: 0,
    opportunities_considered: 0,
    trades: [],
  })

  // a. Master switch — do nothing at all when disabled (not even a log entry).
  if (!ap.enabled) {
    return { ...baseReport(), status: 'disabled', finished_at: new Date().toISOString() }
  }

  const report = baseReport()

  try {
    if (!settings.kalshi_api_key || !settings.kalshi_private_key) {
      throw new Error('Kalshi API Key ID and Private Key are both required for autopilot. Configure them in Settings.')
    }
    const auth: KalshiAuth = {
      keyId: settings.kalshi_api_key,
      privateKey: settings.kalshi_private_key,
    }

    // GO-LIVE GATE (optional — off by default per user setting): when
    // enabled, never place a REAL order for a strategy until THAT STRATEGY's
    // own calibration history shows it beats the market's Brier score over a
    // large enough resolved sample. Dry-run is always exempt — dry-run is how
    // that history accumulates in the first place.
    //
    // Gated PER STRATEGY (in evaluateOpportunity below, via
    // calibrationByStrategy), not once for the whole account: this used to
    // halt the entire cycle on a single pooled Brier/resolved-count check,
    // which meant one strategy with a proven record could never trade while
    // a brand-new, unrelated strategy was still accumulating history, and
    // (worse) a genuinely bad strategy could ride on a good strategy's
    // pooled numbers. StrategyStats.market_brier (storage.ts) is what makes
    // a strategy-scoped comparison possible.
    //
    // Built UNCONDITIONALLY (not just when the go-live gate is on) — it also
    // drives the track-record-aware Kelly haircut in evaluateOpportunity,
    // which applies in dry-run too, independent of require_calibration_to_go_live.
    const calibrationByStrategy = new Map<string, StrategyStats>()
    for (const s of getCalibrationStats().by_strategy) {
      calibrationByStrategy.set(s.strategy, s)
    }
    if (!ap.dry_run) {
      // Best-effort: clear out anything left resting from a prior cycle
      // before this cycle's balance/exposure snapshot is taken.
      await reconcileStaleOrders(auth)
    }

    // b. Fetch balance, open positions, and settlements from Kalshi.
    // These are hard requirements — if any fails we abort (fail-safe), because
    // guardrails cannot be evaluated without them.
    const [balanceData, positionsData, settlementsData] = await Promise.all([
      getPortfolioBalance(auth),
      getPortfolioPositions(auth),
      getPortfolioSettlements(auth, 100),
    ])

    let balance = (Number(balanceData?.balance) || 0) / 100 // cents → dollars

    const rawPositions: any[] = positionsData?.market_positions ?? positionsData?.positions ?? []
    const openPositions = rawPositions.filter((p: any) => Math.abs(positionSignedQuantity(p)) > 0)
    const openTickers = new Set<string>(openPositions.map((p: any) => String(p.ticker)))

    // Cost basis (dollars) per open position.
    const positionCost = positionCostBasisDollars
    let openPositionCount = openPositions.length
    let totalExposure = openPositions.reduce((sum: number, p: any) => sum + positionCost(p), 0)

    // Cluster exposure map seeded from existing open positions
    const clusterExposure = new Map<string, number>()
    for (const p of openPositions) {
      const cluster = clusterForTicker(String(p.ticker))
      clusterExposure.set(cluster, (clusterExposure.get(cluster) ?? 0) + positionCost(p))
    }

    // UNREALIZED mark-to-market snapshot of open positions. Runs
    // unconditionally — NOT gated behind exit_enabled (default false) — this
    // is risk visibility, not the exit policy. Without it, the circuit
    // breaker below only ever sees REALIZED settlement P&L, which is $0 for
    // a position marked down close to its full cost basis but not yet
    // settled: at defaults (max_daily_loss_usd $50 vs max_exposure_usd $250)
    // that leaves the true worst-case same-day drawdown bounded only by the
    // 5x-larger exposure cap, not the daily loss cap it's supposed to be
    // caught by. Fail-safe: a quote that can't be fetched contributes $0 to
    // this sum — UNDERSTATES the drawdown, never overstates it, so it can
    // never falsely trip the breaker, only under-protect against a real one.
    let unrealizedPnlNow = 0
    for (const pos of openPositions) {
      try {
        const ticker = String(pos.ticker)
        const signedQty = positionSignedQuantity(pos)
        const count = Math.abs(signedQty)
        const cost = positionCost(pos)
        if (!(count > 0) || !(cost > 0)) continue
        const isYes = signedQty > 0
        const market = await fetchMarket(auth, ticker).catch(() => null)
        if (!market) continue
        const bid = isYes
          ? bidPrice(market.yes_bid_dollars, market.yes_bid)
          : bidPrice(market.no_bid_dollars, market.no_bid)
        if (!Number.isFinite(bid) || bid <= 0 || bid >= 1) continue
        unrealizedPnlNow += count * bid - cost
      } catch {
        // one bad quote must never abort the snapshot
      }
    }

    // CIRCUIT BREAKER: realized losses today, PLUS current unrealized
    // mark-to-market losses on open positions, exceed the daily loss limit →
    // halt the entire cycle before considering any trade.
    const realizedPnlToday = realizedPnlTodayFromSettlements(settlementsData)
    const combinedPnlToday = realizedPnlToday + unrealizedPnlNow
    if (combinedPnlToday <= -ap.max_daily_loss_usd) {
      report.status = 'halted'
      report.halted = `Circuit breaker: realized P&L today is $${realizedPnlToday.toFixed(2)}, unrealized mark-to-market on open positions is $${unrealizedPnlNow.toFixed(2)} (combined $${combinedPnlToday.toFixed(2)}), at or beyond the -$${ap.max_daily_loss_usd.toFixed(2)} daily loss limit. No trades placed.`
      report.finished_at = new Date().toISOString()
      appendAutopilotRun(report)
      return report
    }

    // Daily spend so far (executed autopilot trades logged today)
    let dailySpend = getTodaySpend()

    // Tickers sold in THIS cycle's exit pass. Separate from openTickers (which
    // the exit pass also clears, on purpose, so freed exposure/cluster/position
    // headroom is available to OTHER new entries this same cycle) — without
    // this, the buy loop could immediately re-buy the exact ticker the exit
    // pass just sold, paying the spread and two fees for a round trip that
    // nets nothing.
    const justSoldTickers = new Set<string>()

    // EXIT PASS: manage open positions with pure price mechanics — no LLM, no
    // Claude call, fully deterministic. Runs AFTER the circuit breaker but
    // BEFORE the buy loop so any capital and position slots freed by a sell are
    // available to new entries in the SAME cycle. Fail-safe: any uncertainty on
    // a position → skip that position (log the reason), never sell blindly; and
    // each position is wrapped so one bad quote can't abort the pass or the buy
    // loop that follows.
    if (ap.exit_enabled) {
      for (const pos of openPositions) {
        try {
          const ticker = String(pos.ticker)
          const signedQty = positionSignedQuantity(pos)
          const count = Math.abs(signedQty)
          const isYes = signedQty > 0
          const side: 'yes' | 'no' = isYes ? 'yes' : 'no'
          const cost = positionCost(pos) // dollars, cost basis of this position
          if (!(count > 0) || !(cost > 0)) continue // nothing to value or sell
          const avgEntry = cost / count // dollars per contract

          // Live quote is required to price the exit — no quote, no sell.
          const market = await fetchMarket(auth, ticker).catch(() => null)
          if (!market) {
            report.trades.push({
              ticker, title: ticker, side, intent: 'sell', strategy: 'exit-management',
              contracts: count, price: 0, cost: 0,
              effective_edge_pct: 0, kelly_stake: 0, executed: false,
              skip_reason: 'Could not fetch live quote',
            })
            continue
          }

          // To CLOSE a long you SELL the same side you hold, hitting its bid.
          const yesBid = bidPrice(market.yes_bid_dollars, market.yes_bid)
          const noBid = bidPrice(market.no_bid_dollars, market.no_bid)
          const marketTitle = typeof market.title === 'string' && market.title ? market.title : ticker
          const sellPrice = isYes ? yesBid : noBid
          if (!Number.isFinite(sellPrice) || sellPrice <= 0 || sellPrice >= 1) {
            report.trades.push({
              ticker, title: marketTitle, side, intent: 'sell', strategy: 'exit-management',
              contracts: count, price: 0, cost: 0,
              effective_edge_pct: 0, kelly_stake: 0, executed: false,
              skip_reason: 'No live bid to sell into',
            })
            continue
          }

          // Gain relative to entry, and Kalshi's per-contract sell fee.
          const gainFrac = (sellPrice - avgEntry) / avgEntry
          const fee = kalshiFeeCoef(ticker) * sellPrice * (1 - sellPrice)
          const netPerContract = sellPrice - fee

          // Take-profit only — no stop-loss. A binary contract converging to
          // 0 or 1 has no momentum to cut; re-running the shrinkage math at a
          // lower price makes the thesis look STRONGER, not weaker, so a
          // fixed-% stop-loss sells exactly the positions the model likes
          // most and pays a second fee to do it. Only exit early on a gain,
          // and only if that gain survives the sell fee.
          let exitReason: string | null = null
          if (gainFrac >= ap.take_profit_pct / 100 && netPerContract > avgEntry) {
            exitReason = 'take_profit'
          }

          // HOLD: log nothing (only actions and skips-with-reasons are logged).
          if (!exitReason) continue

          const sellTrade: AutopilotTrade = {
            ticker,
            title: marketTitle,
            side,
            intent: 'sell',
            strategy: 'exit-management',
            contracts: count,
            price: sellPrice,
            cost: parseFloat((count * sellPrice).toFixed(2)),
            effective_edge_pct: 0,
            kelly_stake: 0,
            exit_reason: exitReason,
            executed: false,
          }

          if (ap.dry_run) {
            report.trades.push({ ...sellTrade, executed: false })
          } else {
            const order = await placeOrder(auth, {
              ticker,
              side,
              count,
              price_cents: Math.round(sellPrice * 100),
              action: 'sell',
              expiration_ts: Math.floor(Date.now() / 1000) + ORDER_EXPIRATION_SECONDS,
            })
            report.trades.push({ ...sellTrade, executed: true, order_id: order.order_id })
          }

          // Tag the originating Prediction (if one was logged for this
          // ticker) as exited early — otherwise it's silently scored as held
          // to resolution once the underlying market eventually settles,
          // even though the actual economics were realized HERE, at this
          // price. Best-effort ticker match against the most recent
          // unresolved autopilot-sourced prediction; a miss just means no
          // ROI-per-exit correction is possible for this sale, never blocks
          // the sell itself. exit_price is fee-net (netPerContract), the
          // same figure the balance/headroom bookkeeping below already uses.
          try {
            const originating = getPredictions().find(
              (p) => p.outcome === undefined && p.source === 'autopilot' &&
                p.ticker && p.ticker.trim().toUpperCase() === ticker.trim().toUpperCase()
            )
            if (originating) {
              updatePrediction(originating.id, {
                exited_early: true,
                exit_price: parseFloat(netPerContract.toFixed(4)),
                exit_ts: new Date().toISOString(),
                exit_reason: exitReason,
              })
            }
          } catch {
            // exit tagging is non-critical — never block the sell or the cycle
          }

          // Free guardrail headroom and credit approximate proceeds so the buy
          // loop sees a realistic post-sell cycle. On dry-run we mirror the same
          // adjustment so the logged cycle reflects what a live cycle would do.
          balance += count * netPerContract
          openPositionCount = Math.max(0, openPositionCount - 1)
          totalExposure = Math.max(0, totalExposure - cost)
          const cluster = clusterForTicker(ticker)
          clusterExposure.set(cluster, Math.max(0, (clusterExposure.get(cluster) ?? 0) - cost))
          openTickers.delete(ticker)
          justSoldTickers.add(ticker)
        } catch (err: any) {
          // One bad position must never abort the exit pass or the buy loop.
          report.trades.push({
            ticker: String(pos.ticker),
            title: String(pos.ticker),
            side: positionSignedQuantity(pos) > 0 ? 'yes' : 'no',
            intent: 'sell',
            strategy: 'exit-management',
            contracts: Math.abs(positionSignedQuantity(pos)),
            price: 0,
            cost: 0,
            effective_edge_pct: 0,
            kelly_stake: 0,
            executed: false,
            skip_reason: `Exit check failed: ${err?.message || String(err)}`,
          })
        }
      }
    }

    // c. Registry: gather opportunities from every enabled strategy, each
    // tagged with its origin — the entire mechanism behind per-strategy P&L
    // attribution (see getCalibrationStats' by_strategy breakdown). Every
    // strategy funnels through the SAME guardrail/Kelly/logging pipeline
    // below. One strategy's failure must never abort the cycle or the others.
    //
    // Run all enabled strategies CONCURRENTLY, not sequentially. Dated
    // Favorites and Settlement Sniping each paginate the ENTIRE open-market
    // list on their own (up to 25 pages); with all three strategies on, a
    // sequential await-one-then-the-next cycle could take minutes of wall
    // clock time for no reason — none of these strategies depend on each
    // other's output, so there's nothing gained by serializing them.
    const strategyOpportunities: StrategyOpportunity[] = []
    let marketsScanned = 0
    let llmScreenedOut: { ticker: string; title: string; reason: string; direction?: 'YES' | 'NO'; edge_pct?: number }[] = []

    interface LlmResult { kind: 'llm'; opportunities: StrategyOpportunity[]; marketsScanned: number; screenedOut: typeof llmScreenedOut }
    interface MechanicalResult { kind: 'mechanical'; opportunities: StrategyOpportunity[] }
    const strategyTasks: Promise<LlmResult | MechanicalResult>[] = []

    if (ap.strategy_llm_divergence_enabled !== false) {
      strategyTasks.push((async (): Promise<LlmResult> => {
        // Autopilot logs its own predictions for executed trades, so suppress
        // the scanner's own logging. Scanning more markets never loosens a
        // safety gate — it only gives the confidence/edge/cluster filters more
        // candidates to choose from. A breadth of 15 statistically surfaced ~0
        // tradeable opportunities; 40 matches the manual scanner's sweet spot.
        const scan = await runScan({
          limit: ap.scan_limit ?? 40,
          min_volume: 0,
          // No artificial ceiling here — an earlier version capped this at 0.07
          // regardless of the configured guardrail, which silently undermined any
          // min_effective_edge_pct set above 7% (the scan-level filter runs BEFORE
          // evaluateOpportunity, so opportunities never even reached the guardrail
          // check). The guardrail is the intended single source of truth for this
          // threshold; the scan filter must match it exactly, not undercut it.
          min_effective_edge: ap.min_effective_edge_pct / 100,
          max_days_to_resolution: ap.max_days_to_resolution,
          logPredictions: false,
        })
        return {
          kind: 'llm',
          marketsScanned: scan.markets_scanned,
          screenedOut: scan.screened_out ?? [],
          opportunities: scan.opportunities.map((o): StrategyOpportunity => ({
            strategy: 'llm-divergence',
            ticker: o.ticker,
            title: o.title,
            direction: o.direction,
            execution_price: o.execution_price ?? o.yes_price ?? 0,
            edge_pct: o.edge_pct,
            p_shrunk: o.p_shrunk,
            confidence: o.confidence,
            category: o.category,
            resolution_date: o.resolution_date,
            rationale: o.rationale,
            raw_probability: (o.my_estimate_pct ?? 50) / 100,
            days_to_resolution: o.days_to_resolution,
            annualized_edge_pct: o.annualized_edge_pct,
          })),
        }
      })())
    }

    if (ap.strategy_dated_favorites_enabled) {
      strategyTasks.push(
        datedFavoritesOpportunities(ap)
          .then((opportunities): MechanicalResult => ({ kind: 'mechanical', opportunities }))
          // mechanical strategies are best-effort — a fetch failure this
          // cycle just means zero candidates from this strategy, never an
          // aborted cycle or a blocked llm-divergence result.
          .catch((): MechanicalResult => ({ kind: 'mechanical', opportunities: [] }))
      )
    }

    if (ap.strategy_settlement_snipe_enabled) {
      strategyTasks.push(
        settlementSnipeOpportunities(ap)
          .then((opportunities): MechanicalResult => ({ kind: 'mechanical', opportunities }))
          .catch((): MechanicalResult => ({ kind: 'mechanical', opportunities: [] }))
      )
    }

    const strategyResults = await Promise.all(strategyTasks)
    for (const result of strategyResults) {
      strategyOpportunities.push(...result.opportunities)
      if (result.kind === 'llm') {
        marketsScanned = result.marketsScanned
        llmScreenedOut = result.screenedOut
      }
    }

    report.markets_scanned = marketsScanned
    report.opportunities_considered = strategyOpportunities.length
    // Recorded UNCONDITIONALLY, not just when a zero-buy cycle surfaces up to
    // 5 near-misses below — this is the only place the TRUE tier-1 (pre-
    // guardrail) rejection count survives for funnel analysis
    // (getAutopilotFunnelStats in storage.ts).
    report.opportunities_screened_out = llmScreenedOut.length
    report.use_maker_orders = ap.use_maker_orders

    const minConfidenceRank = CONFIDENCE_RANK[ap.min_confidence] ?? CONFIDENCE_RANK.HIGH

    // d. Evaluate each opportunity against filters + guardrails, best
    // CAPITAL-ANNUALIZED edge first, regardless of which strategy found it —
    // a 5% edge resolving in a week is far more capital-efficient than a 5%
    // edge resolving in a year, and should get first claim on limited daily-
    // spend/exposure headroom. Mirrors scan.ts's own sort exactly, including
    // its fallback: opportunities with no resolution date (annualized_edge_pct
    // null) fall back to raw edge_pct and sort after every dated one.
    strategyOpportunities.sort((a, b) =>
      (b.annualized_edge_pct ?? -Infinity) - (a.annualized_edge_pct ?? -Infinity) || b.edge_pct - a.edge_pct
    )

    // A ticker with an unresolved autopilot prediction already logged gets
    // re-surfaced every cycle it still qualifies until it resolves — without
    // this, the SAME opportunity racks up duplicate Prediction rows every
    // cycle it appears, most acutely in dry-run: a dry-run "buy" never
    // becomes a real Kalshi position, so openTickers (built from the real
    // account) never reflects it and never blocks a re-log the way a live
    // buy naturally would on the next cycle. Mirrors scan.ts's own
    // pendingTickers pattern exactly.
    const pendingPredictionTickers = new Set(
      getPredictions()
        .filter((p) => p.outcome === undefined && p.ticker && p.source === 'autopilot')
        .map((p) => p.ticker!.trim().toUpperCase())
    )

    for (const opp of strategyOpportunities) {
      const decision = evaluateOpportunity(opp, {
        ap,
        minConfidenceRank,
        balance,
        dailySpend,
        openPositionCount,
        totalExposure,
        clusterExposure,
        openTickers,
        justSoldTickers,
        calibrationByStrategy,
      })

      if ('skip' in decision) {
        report.trades.push(decision.skip)
        continue
      }

      let trade = decision.trade

      // MAKER MODE (opt-in): reprice at the current bid and rest as
      // post_only instead of crossing at the scan-time ask. Contracts stay
      // sized off the ask (the conservative upper bound from evaluateOpportunity
      // above) — filling at a lower bid price only means less capital is
      // actually spent than budgeted, never more, so every headroom check
      // already performed above remains valid. A live quote is required to
      // price this correctly; if it can't be fetched, skip the trade rather
      // than silently falling back to a taker fill the user opted out of.
      if (ap.use_maker_orders) {
        const market = await fetchMarket(auth, trade.ticker).catch(() => null)
        const bid = market
          ? trade.side === 'yes'
            ? bidPrice(market.yes_bid_dollars, market.yes_bid)
            : bidPrice(market.no_bid_dollars, market.no_bid)
          : 0
        const bidCents = Math.round(bid * 100)
        if (!market || !Number.isFinite(bid) || bidCents < 1 || bidCents > 99) {
          report.trades.push({
            ...trade, contracts: 0, price: 0, cost: 0, executed: false,
            skip_reason: 'Maker mode: no live bid to rest an order against',
          })
          continue
        }
        trade = { ...trade, price: bid, cost: parseFloat((trade.contracts * bid).toFixed(2)) }
      }

      // 'maker' vs 'taker' — set unconditionally (both dry-run and live log
      // it) so realized ROI can eventually be broken out by fee tier once a
      // fee-adjusted-ROI join exists; today it's visibility, not yet used.
      trade = { ...trade, order_type: ap.use_maker_orders ? 'maker' : 'taker' }

      if (ap.dry_run) {
        // Dry run: log the would-be order, place nothing, but still consume
        // guardrail headroom within this cycle so the log reflects what a
        // live cycle would actually have done.
        report.trades.push({ ...trade, executed: false })
      } else {
        // LIVE: place a limit order. Taker crosses at the scan-time ask
        // (immediate_or_cancel); maker rests at the just-fetched bid
        // (post_only, bounded by MAKER_ORDER_EXPIRATION_SECONDS). Cents
        // conversion happens here, at the API boundary, and nowhere else.
        const priceCents = Math.round(trade.price * 100)
        const order = await placeOrder(auth, {
          ticker: trade.ticker,
          side: trade.side,
          count: trade.contracts,
          price_cents: priceCents,
          postOnly: ap.use_maker_orders,
          expiration_ts: Math.floor(Date.now() / 1000) +
            (ap.use_maker_orders ? MAKER_ORDER_EXPIRATION_SECONDS : ORDER_EXPIRATION_SECONDS),
        })
        report.trades.push({ ...trade, executed: true, order_id: order.order_id })
      }

      // Record the prediction for calibration tracking (best-effort) — on
      // BOTH dry-run and live now, not live-only. The go-live gate's own
      // comment says "dry-run is how that history accumulates in the first
      // place"; until this logged unconditionally, dry-run mode produced
      // ZERO autopilot-attributed predictions, so that history never
      // actually accumulated. predicted_probability prefers raw_probability
      // (Claude's UNSHRUNK self-report, llm-divergence only) so calibration
      // measures the model's own calibration, not the blended trading
      // decision — see STRATEGY_PLAN.md Phase 1. Mechanical strategies have
      // no separate raw estimate; p_shrunk IS the belief there.
      const tickerKey = trade.ticker.trim().toUpperCase()
      if (!pendingPredictionTickers.has(tickerKey)) {
        try {
          createPrediction({
            market_title: opp.title,
            ticker: opp.ticker,
            category: opp.category,
            predicted_probability: opp.raw_probability ?? opp.p_shrunk,
            direction: opp.direction,
            market_price: trade.price,
            edge_pct: opp.edge_pct,
            resolution_date: opp.resolution_date ?? undefined,
            source: 'autopilot',
            strategy: opp.strategy,
            confidence: opp.confidence,
            execution_price: trade.price,
            haircut_pp_applied: trade.haircut_pp_applied,
            kelly_fraction_used: trade.kelly_fraction_used,
          })
          pendingPredictionTickers.add(tickerKey)
        } catch {
          // prediction logging is non-critical
        }
      }

      // Consume headroom for subsequent opportunities in this cycle
      balance -= trade.cost
      dailySpend += trade.cost
      totalExposure += trade.cost
      openPositionCount += 1
      openTickers.add(trade.ticker)
      const cluster = clusterForTicker(trade.ticker, opp.title)
      clusterExposure.set(cluster, (clusterExposure.get(cluster) ?? 0) + trade.cost)
    }

    // VISIBILITY: on a cycle that executed/queued no buys, surface the closest
    // near-misses so the log shows tangible output ("here's what came close and
    // why") instead of looking empty or broken. These are markets Claude flagged
    // that the code screened out — most usefully, ones just below the effective-
    // edge threshold, whose reason already carries the computed edge. Logged as
    // informational skips; they render in the existing decision log with no
    // schema or UI change. Capped so a big scan can't flood the log.
    const executedOrQueuedBuys = report.trades.some(
      (t) => t.intent !== 'sell' && !t.skip_reason
    )
    if (!executedOrQueuedBuys) {
      const nearMisses = llmScreenedOut
        .filter((s) => /effective edge/i.test(s.reason))
        .slice(0, 5)
      for (const nm of nearMisses) {
        report.trades.push({
          ticker: nm.ticker,
          title: nm.title,
          // Was hardcoded 'yes' regardless of Claude's actual call — the Side
          // column showed YES even when the reason text said "Claude said NO".
          side: nm.direction === 'NO' ? 'no' : 'yes',
          contracts: 0,
          price: 0,
          cost: 0,
          // Was hardcoded 0 — the Edge column showed 0.0% even when the reason
          // text described a clearly negative effective edge.
          effective_edge_pct: nm.edge_pct ?? 0,
          kelly_stake: 0,
          executed: false,
          skip_reason: `Near miss — ${nm.reason}`,
          strategy: 'llm-divergence',
        })
      }
    }

    report.finished_at = new Date().toISOString()
    appendAutopilotRun(report)
    return report
  } catch (error: any) {
    // g. Any Kalshi auth/order/scan error aborts the cycle. Never retry order
    // placement automatically — a human must look at what happened.
    report.status = 'error'
    report.error = error?.message || 'Autopilot cycle failed'
    report.finished_at = new Date().toISOString()
    try {
      appendAutopilotRun(report)
    } catch {
      // persisting the failure record is best-effort
    }
    return report
  }
}

interface GuardrailContext {
  ap: ReturnType<typeof getSettings>['autopilot']
  minConfidenceRank: number
  balance: number
  dailySpend: number
  openPositionCount: number
  totalExposure: number
  clusterExposure: Map<string, number>
  openTickers: Set<string>
  justSoldTickers: Set<string>
  // Per-strategy calibration snapshot for the go-live gate — empty unless
  // !dry_run && require_calibration_to_go_live (runAutopilotCycle only pays
  // for getCalibrationStats() when it's actually needed).
  calibrationByStrategy: Map<string, StrategyStats>
}

type Decision =
  | { trade: AutopilotTrade }
  | { skip: AutopilotTrade }

// Pure decision function: given one opportunity and the current guardrail
// state, either produce a sized trade or a logged skip reason. Never throws.
function evaluateOpportunity(opp: StrategyOpportunity, ctx: GuardrailContext): Decision {
  const { ap } = ctx
  const side: 'yes' | 'no' = opp.direction === 'YES' ? 'yes' : 'no'

  const skip = (reason: string, extra?: Partial<AutopilotTrade>): Decision => ({
    skip: {
      ticker: opp.ticker,
      title: opp.title,
      side,
      contracts: 0,
      price: opp.execution_price ?? 0,
      cost: 0,
      effective_edge_pct: opp.edge_pct,
      kelly_stake: 0,
      executed: false,
      skip_reason: reason,
      strategy: opp.strategy,
      rationale: opp.rationale,
      confidence: opp.confidence,
      ...extra,
    },
  })

  // --- Signal filters -------------------------------------------------------
  if (opp.edge_pct < ap.min_effective_edge_pct) {
    return skip(`Effective edge ${opp.edge_pct.toFixed(1)}% below minimum ${ap.min_effective_edge_pct}%`)
  }
  if ((CONFIDENCE_RANK[opp.confidence] ?? 0) < ctx.minConfidenceRank) {
    return skip(`Confidence ${opp.confidence} below minimum ${ap.min_confidence}`)
  }
  const blacklisted = ap.category_blacklist.some(
    (bl) => bl && opp.category.toLowerCase().includes(bl.toLowerCase())
  )
  if (blacklisted) {
    return skip(`Category "${opp.category}" is blacklisted`)
  }

  // GO-LIVE GATE, evaluated PER STRATEGY (see the comment at its call site in
  // runAutopilotCycle for why this moved from a whole-cycle halt to a
  // per-opportunity skip). ctx.calibrationByStrategy is empty whenever the
  // gate is off or we're in dry-run, so this is a no-op in both those cases.
  if (!ap.dry_run && ap.require_calibration_to_go_live) {
    const stats = ctx.calibrationByStrategy.get(opp.strategy)
    const required = ap.min_resolved_predictions_for_live
    const enoughSamples = !!stats && stats.resolved >= required
    const beatsMarket = !!stats && stats.market_brier != null && stats.brier != null && stats.brier < stats.market_brier
    if (!enoughSamples || !beatsMarket) {
      return skip(
        !enoughSamples
          ? `Live trading gate not met for strategy "${opp.strategy}": only ${stats?.resolved ?? 0}/${required} predictions resolved for this strategy. Switch to dry-run and keep scanning until enough history accumulates.`
          : `Live trading gate not met for strategy "${opp.strategy}": Brier ${stats!.brier!.toFixed(3)} does not beat market Brier ${stats!.market_brier!.toFixed(3)} over ${stats!.resolved} resolved predictions for this strategy.`
      )
    }
  }

  // Absolute horizon backstop — NOT the same check as scan.ts's
  // max_days_to_resolution filter (that one is llm-divergence-specific and
  // user-tunable; dated-favorites and settlement-snipe enforce their OWN
  // horizon via their own settings, already hard-bounded in their strategy
  // modules). This is a single, non-configurable ceiling applied here so
  // every strategy — present and future — is covered by one guarantee: no
  // opportunity that resolves more than a year out is ever tradeable, no
  // matter how a per-strategy setting gets misconfigured. Multi-year
  // contracts tie up capital for years per point of edge and can't be used
  // to validate the model on any useful timescale. Fails closed: a missing
  // or unparseable resolution date can't be proven safe, so it's skipped.
  if (!opp.resolution_date) {
    return skip('No resolution date available — cannot verify horizon, skipping by default')
  }
  const resolveTs = Date.parse(opp.resolution_date)
  if (!Number.isFinite(resolveTs)) {
    return skip('Resolution date could not be parsed — cannot verify horizon, skipping by default')
  }
  const daysToResolution = (resolveTs - Date.now()) / (1000 * 60 * 60 * 24)
  if (daysToResolution > ABSOLUTE_MAX_DAYS_TO_RESOLUTION) {
    return skip(
      `Resolves in ${Math.round(daysToResolution)}d — beyond the ${ABSOLUTE_MAX_DAYS_TO_RESOLUTION}-day absolute ` +
      `horizon ceiling (multi-year contracts lock up capital and can't validate the model on any useful timescale)`
    )
  }

  // Fail-safe: no valid execution price → never trade
  const price = opp.execution_price
  if (price == null || !Number.isFinite(price) || price <= 0 || price >= 1) {
    return skip('No valid execution price for this market')
  }
  const priceCents = Math.round(price * 100)
  if (priceCents < 1 || priceCents > 99) {
    return skip(`Execution price ${priceCents}¢ outside valid 1–99¢ range`)
  }

  // --- Guardrails that are independent of trade size -------------------------
  if (ctx.openTickers.has(opp.ticker)) {
    return skip('Already holding a position in this ticker (no averaging)')
  }
  if (ctx.justSoldTickers.has(opp.ticker)) {
    return skip('Just sold this position this cycle — wait for next cycle before re-entering')
  }
  if (ctx.openPositionCount >= ap.max_open_positions) {
    return skip(`Open positions (${ctx.openPositionCount}) at maximum of ${ap.max_open_positions}`)
  }
  const dailyRemaining = ap.max_daily_spend_usd - ctx.dailySpend
  if (dailyRemaining <= 0) {
    return skip(`Daily spend limit reached ($${ctx.dailySpend.toFixed(2)} of $${ap.max_daily_spend_usd.toFixed(2)})`)
  }
  const exposureRemaining = ap.max_exposure_usd - ctx.totalExposure
  if (exposureRemaining <= 0) {
    return skip(`Total exposure limit reached ($${ctx.totalExposure.toFixed(2)} of $${ap.max_exposure_usd.toFixed(2)})`)
  }
  const cluster = clusterForTicker(opp.ticker, opp.title)
  const clusterCost = ctx.clusterExposure.get(cluster) ?? 0
  const clusterRemaining = ap.max_per_cluster_usd - clusterCost
  if (clusterRemaining <= 0) {
    return skip(`Cluster "${cluster}" exposure limit reached ($${clusterCost.toFixed(2)} of $${ap.max_per_cluster_usd.toFixed(2)})`)
  }

  // --- Kelly sizing (all dollars) ------------------------------------------
  // b = net odds = payout/stake for the chosen side; p = shrunk win probability.
  //
  // Composition ceiling, worth stating explicitly: for llm-divergence,
  // p_shrunk already discounts Claude's raw estimate 60/40 toward the market
  // price (scan.ts SHRINK_CLAUDE = 0.40), so the fraction of bankroll staked
  // here is bounded by f ≤ kelly_fraction × SHRINK_CLAUDE ≈ 0.25 × 0.40 = 10%
  // of what naive full-Kelly at Claude's RAW (unshrunk) estimate would size —
  // before the confidence haircut below shrinks it further. Two independent,
  // separately-tuned mechanisms (this shrink and the haircut below) both
  // exist to address the SAME risk (unquantified LLM estimation error), with
  // no joint calibration between them — see docs/STRATEGY_PLAN.md, which
  // calls the shrink split itself "a guess with no empirical basis."
  //
  // Kelly assumes p is the TRUE probability. Ours is an LLM estimate blended
  // with a market price, carrying substantial unquantified error — and Kelly
  // is hypersensitive to error in p: overestimating by a few points turns
  // quarter-Kelly into effectively over-levered. So size from a conservative
  // LOWER BOUND on p, haircut by Claude's own stated confidence, rather than
  // from the point estimate.
  const b = (1 - price) / price
  const pRaw = opp.direction === 'YES' ? opp.p_shrunk : 1 - opp.p_shrunk

  // Track-record-aware confidence: a strategy's self-reported confidence is
  // only as trustworthy as the track record backing it. Both mechanical
  // strategies hardcode confidence HIGH purely to clear the min_confidence
  // gate (see their own "gated on the safety margin above" comments) — with
  // ZERO production history behind that label, it's indistinguishable from a
  // genuinely-earned HIGH call, yet draws the SAME smallest haircut (3pp
  // default) as one. Cap the EFFECTIVE tier at MEDIUM until the strategy has
  // its own resolved sample at least as large as the go-live floor
  // (min_resolved_predictions_for_live) — applies uniformly to every
  // strategy, including a brand-new llm-divergence deployment, not just the
  // mechanical ones specifically.
  const strategyStats = ctx.calibrationByStrategy.get(opp.strategy)
  const strategyProven = (strategyStats?.resolved ?? 0) >= ap.min_resolved_predictions_for_live
  const effectiveConfidence: 'LOW' | 'MEDIUM' | 'HIGH' =
    !strategyProven && opp.confidence === 'HIGH' ? 'MEDIUM' : opp.confidence

  const haircutPp =
    effectiveConfidence === 'HIGH' ? ap.kelly_haircut_high_pp
    : effectiveConfidence === 'MEDIUM' ? ap.kelly_haircut_medium_pp
    : ap.kelly_haircut_low_pp
  const p = Math.max(0.01, pRaw - (haircutPp ?? 0) / 100)
  const q = 1 - p
  const kellyFull = (p * b - q) / b
  if (!Number.isFinite(kellyFull) || kellyFull <= 0) {
    const trackRecordNote = effectiveConfidence !== opp.confidence
      ? ` — capped from self-reported ${opp.confidence} pending track record (${strategyStats?.resolved ?? 0}/${ap.min_resolved_predictions_for_live} resolved)`
      : ''
    return skip(
      `Kelly criterion is non-positive after the ${haircutPp}pp ${effectiveConfidence}-confidence ` +
      `haircut (win prob ${(pRaw * 100).toFixed(1)}% → ${(p * 100).toFixed(1)}% at ${priceCents}¢)${trackRecordNote}`
    )
  }
  const f = ap.kelly_fraction * kellyFull

  // Stake = fraction of available cash, clamped to per-trade cap and every
  // guardrail's remaining headroom.
  const headroom = Math.min(
    ap.max_per_trade_usd,
    dailyRemaining,
    exposureRemaining,
    clusterRemaining,
    ctx.balance
  )
  const kellyStake = Math.min(f * ctx.balance, headroom)

  const contracts = Math.floor(kellyStake / price)
  if (contracts < 1) {
    return skip(`Kelly stake $${Math.max(kellyStake, 0).toFixed(2)} buys less than 1 contract at ${priceCents}¢`)
  }
  const cost = contracts * price

  // --- Belt-and-braces re-checks with the final cost -------------------------
  // The headroom clamp above should make these unreachable; they exist so a
  // sizing bug can never translate into a limit-violating order.
  if (ctx.dailySpend + cost > ap.max_daily_spend_usd) {
    return skip(`Daily spend $${ctx.dailySpend.toFixed(2)} + $${cost.toFixed(2)} would exceed $${ap.max_daily_spend_usd.toFixed(2)} limit`)
  }
  if (ctx.totalExposure + cost > ap.max_exposure_usd) {
    return skip(`Total exposure $${ctx.totalExposure.toFixed(2)} + $${cost.toFixed(2)} would exceed $${ap.max_exposure_usd.toFixed(2)} limit`)
  }
  if (clusterCost + cost > ap.max_per_cluster_usd) {
    return skip(`Cluster "${cluster}" exposure $${clusterCost.toFixed(2)} + $${cost.toFixed(2)} would exceed $${ap.max_per_cluster_usd.toFixed(2)} cap`)
  }
  if (cost > ctx.balance) {
    return skip(`Insufficient balance: cost $${cost.toFixed(2)} exceeds available $${ctx.balance.toFixed(2)}`)
  }

  return {
    trade: {
      ticker: opp.ticker,
      title: opp.title,
      side,
      contracts,
      price,
      cost: parseFloat(cost.toFixed(2)),
      effective_edge_pct: opp.edge_pct,
      kelly_stake: parseFloat(kellyStake.toFixed(2)),
      executed: false, // caller sets true after a live order succeeds
      strategy: opp.strategy,
      rationale: opp.rationale,
      confidence: opp.confidence,
      haircut_pp_applied: haircutPp,
      kelly_fraction_used: ap.kelly_fraction,
    },
  }
}
