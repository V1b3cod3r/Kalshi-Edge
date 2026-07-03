import {
  getSettings,
  getAutopilotRuns,
  appendAutopilotRun,
  createPrediction,
} from '@/lib/storage'
import {
  placeOrder,
  getPortfolioBalance,
  getPortfolioPositions,
  getPortfolioSettlements,
  KalshiAuth,
} from '@/lib/kalshi'
import { runScan, ScanOpportunity } from '@/lib/scan'
import { AutopilotRun, AutopilotTrade } from '@/lib/types'

// ---------------------------------------------------------------------------
// Autopilot: nearly-autonomous trade execution with hard, code-enforced
// guardrails. Every dollar figure in this module is in DOLLARS; conversion to
// cents happens only at the Kalshi API boundary (placeOrder price_cents).
// Fail-safe philosophy: any uncertainty (missing price, stale data, parse
// failure) → skip, never trade. Order errors abort the cycle, never retry.
// ---------------------------------------------------------------------------

export interface AutopilotReport extends AutopilotRun {}

const CONFIDENCE_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

// Semantic correlation clusters — markets in the same cluster tend to resolve
// on the same underlying event, so we cap combined cost basis per cluster.
const CLUSTER_KEYWORDS: Array<{ cluster: string; keywords: string[] }> = [
  { cluster: 'macro-rates', keywords: ['rates', 'fed', 'cpi', 'inflation'] },
  { cluster: 'crypto', keywords: ['btc', 'eth', 'sol', 'crypto'] },
  { cluster: 'equities', keywords: ['s&p', 'nasdaq', 'inx'] },
  { cluster: 'politics', keywords: ['trump', 'election', 'senate', 'congress'] },
  { cluster: 'weather', keywords: ['temperature', 'rain', 'snow', 'weather'] },
]

export function clusterForTicker(ticker: string, title?: string): string {
  const haystack = `${ticker} ${title ?? ''}`.toLowerCase()
  for (const { cluster, keywords } of CLUSTER_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return cluster
  }
  return ticker.slice(0, 4).toUpperCase()
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
    pnl += (Number(s.profit) || 0) / 100 // cents → dollars
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
    const openPositions = rawPositions.filter((p: any) => Math.abs(Number(p.position) || 0) > 0)
    const openTickers = new Set<string>(openPositions.map((p: any) => String(p.ticker)))

    // Cost basis (dollars) per open position; prefer Kalshi's market_exposure,
    // fall back to total_traded. Both are in cents.
    const positionCost = (p: any): number => {
      const cents = Math.abs(Number(p.market_exposure ?? p.total_traded) || 0)
      return cents / 100
    }
    let openPositionCount = openPositions.length
    let totalExposure = openPositions.reduce((sum: number, p: any) => sum + positionCost(p), 0)

    // Cluster exposure map seeded from existing open positions
    const clusterExposure = new Map<string, number>()
    for (const p of openPositions) {
      const cluster = clusterForTicker(String(p.ticker))
      clusterExposure.set(cluster, (clusterExposure.get(cluster) ?? 0) + positionCost(p))
    }

    // CIRCUIT BREAKER: realized losses today exceed the daily loss limit →
    // halt the entire cycle before considering any trade.
    const realizedPnlToday = realizedPnlTodayFromSettlements(settlementsData)
    if (realizedPnlToday <= -ap.max_daily_loss_usd) {
      report.status = 'halted'
      report.halted = `Circuit breaker: realized P&L today is $${realizedPnlToday.toFixed(2)}, at or beyond the -$${ap.max_daily_loss_usd.toFixed(2)} daily loss limit. No trades placed.`
      report.finished_at = new Date().toISOString()
      appendAutopilotRun(report)
      return report
    }

    // Daily spend so far (executed autopilot trades logged today)
    let dailySpend = getTodaySpend()

    // c. Run the shared market scan pipeline. Autopilot logs its own
    // predictions for executed trades, so suppress the scanner's logging.
    const scan = await runScan({
      limit: 15,
      min_volume: 0,
      min_effective_edge: Math.min(ap.min_effective_edge_pct / 100, 0.07),
      logPredictions: false,
    })
    report.markets_scanned = scan.markets_scanned
    report.opportunities_considered = scan.opportunities.length

    const minConfidenceRank = CONFIDENCE_RANK[ap.min_confidence] ?? CONFIDENCE_RANK.HIGH

    // d. Evaluate each opportunity against filters + guardrails, best edge first.
    for (const opp of scan.opportunities) {
      const decision = evaluateOpportunity(opp, {
        ap,
        minConfidenceRank,
        balance,
        dailySpend,
        openPositionCount,
        totalExposure,
        clusterExposure,
        openTickers,
      })

      if ('skip' in decision) {
        report.trades.push(decision.skip)
        continue
      }

      const trade = decision.trade

      if (ap.dry_run) {
        // Dry run: log the would-be order, place nothing, but still consume
        // guardrail headroom within this cycle so the log reflects what a
        // live cycle would actually have done.
        report.trades.push({ ...trade, executed: false })
      } else {
        // LIVE: place a limit order at the ask. Cents conversion happens here,
        // at the API boundary, and nowhere else.
        const priceCents = Math.round(trade.price * 100)
        const order = await placeOrder(auth, {
          ticker: trade.ticker,
          side: trade.side,
          count: trade.contracts,
          price_cents: priceCents,
        })
        report.trades.push({ ...trade, executed: true, order_id: order.order_id })

        // Record the prediction for calibration tracking (best-effort)
        try {
          createPrediction({
            market_title: opp.title,
            ticker: opp.ticker,
            category: opp.category,
            predicted_probability: (opp.my_estimate_pct ?? 50) / 100,
            direction: opp.direction,
            market_price: opp.yes_price ?? trade.price,
            edge_pct: opp.edge_pct,
            resolution_date: opp.resolution_date ?? undefined,
            source: 'autopilot',
          })
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
}

type Decision =
  | { trade: AutopilotTrade }
  | { skip: AutopilotTrade }

// Pure decision function: given one opportunity and the current guardrail
// state, either produce a sized trade or a logged skip reason. Never throws.
function evaluateOpportunity(opp: ScanOpportunity, ctx: GuardrailContext): Decision {
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
  const b = (1 - price) / price
  const p = opp.direction === 'YES' ? opp.p_shrunk : 1 - opp.p_shrunk
  const q = 1 - p
  const kellyFull = (p * b - q) / b
  if (!Number.isFinite(kellyFull) || kellyFull <= 0) {
    return skip(`Kelly criterion is non-positive (shrunk win prob ${(p * 100).toFixed(1)}% at ${priceCents}¢) — no edge after shrinkage`)
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
    },
  }
}
