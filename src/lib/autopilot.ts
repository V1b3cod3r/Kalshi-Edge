import {
  getSettings,
  getAutopilotRuns,
  appendAutopilotRun,
  createPrediction,
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
import { runScan, ScanOpportunity, KALSHI_FEE_COEF } from '@/lib/scan'
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

// Orders are priced at the current ask expecting an immediate fill (see the
// buy loop below) — 60s is generous headroom for that, not a resting window.
// Anything still open after this either filled seconds ago (harmless no-op
// cancel) or the price moved away, in which case it should never sit forever
// silently consuming spend/exposure headroom.
const ORDER_EXPIRATION_SECONDS = 60

// Reconciliation safety net: cancel any order still resting from a prior
// cycle (crash, timeout, expiration_ts not honored by an older order) before
// this cycle's balance/exposure snapshot is taken. Best-effort — a failure
// here must never block the cycle; the exit pass and guardrails already
// protect capital even if a stray order lingers.
async function reconcileStaleOrders(auth: KalshiAuth): Promise<void> {
  try {
    const orders = await getOpenOrders(auth)
    const staleCutoffMs = Date.now() - 5 * 60 * 1000
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
    // enabled, never place a REAL order until this account's own calibration
    // history shows Claude actually beats the market's Brier score over a
    // large enough resolved sample. Dry-run is always exempt — dry-run is how
    // that history accumulates in the first place.
    if (!ap.dry_run) {
      if (ap.require_calibration_to_go_live) {
        const calibration = getCalibrationStats()
        const required = ap.min_resolved_predictions_for_live
        const enoughSamples = calibration.resolved_predictions >= required
        const beatsMarket = calibration.market_brier != null && calibration.claude_brier < calibration.market_brier
        if (!enoughSamples || !beatsMarket) {
          report.status = 'halted'
          report.halted = !enoughSamples
            ? `Live trading gate not met: only ${calibration.resolved_predictions}/${required} predictions have resolved. Switch to dry-run and keep scanning until enough history accumulates.`
            : `Live trading gate not met: Claude Brier ${calibration.claude_brier.toFixed(3)} does not beat market Brier ${calibration.market_brier!.toFixed(3)} over ${calibration.resolved_predictions} resolved predictions. The model is not demonstrably better than the market yet — switch back to dry-run.`
          report.finished_at = new Date().toISOString()
          appendAutopilotRun(report)
          return report
        }
      }
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
              ticker, title: ticker, side, intent: 'sell',
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
              ticker, title: marketTitle, side, intent: 'sell',
              contracts: count, price: 0, cost: 0,
              effective_edge_pct: 0, kelly_stake: 0, executed: false,
              skip_reason: 'No live bid to sell into',
            })
            continue
          }

          // Gain relative to entry, and Kalshi's per-contract sell fee.
          const gainFrac = (sellPrice - avgEntry) / avgEntry
          const fee = KALSHI_FEE_COEF * sellPrice * (1 - sellPrice)
          const netPerContract = sellPrice - fee

          let exitReason: string | null = null
          if (gainFrac >= ap.take_profit_pct / 100 && netPerContract > avgEntry) {
            // Take profit — but only if still a gain net of the sell fee.
            exitReason = 'take_profit'
          } else if (gainFrac <= -ap.stop_loss_pct / 100) {
            // Stop loss — thesis broken, cut it regardless of fee.
            exitReason = 'stop_loss'
          }

          // HOLD: log nothing (only actions and skips-with-reasons are logged).
          if (!exitReason) continue

          const sellTrade: AutopilotTrade = {
            ticker,
            title: marketTitle,
            side,
            intent: 'sell',
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

          // Free guardrail headroom and credit approximate proceeds so the buy
          // loop sees a realistic post-sell cycle. On dry-run we mirror the same
          // adjustment so the logged cycle reflects what a live cycle would do.
          balance += count * netPerContract
          openPositionCount = Math.max(0, openPositionCount - 1)
          totalExposure = Math.max(0, totalExposure - cost)
          const cluster = clusterForTicker(ticker)
          clusterExposure.set(cluster, Math.max(0, (clusterExposure.get(cluster) ?? 0) - cost))
          openTickers.delete(ticker)
        } catch (err: any) {
          // One bad position must never abort the exit pass or the buy loop.
          report.trades.push({
            ticker: String(pos.ticker),
            title: String(pos.ticker),
            side: positionSignedQuantity(pos) > 0 ? 'yes' : 'no',
            intent: 'sell',
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

    // c. Run the shared market scan pipeline. Autopilot logs its own
    // predictions for executed trades, so suppress the scanner's logging.
    // Scanning more markets never loosens a safety gate — it only gives the
    // confidence/edge/cluster filters more candidates to choose from. A breadth
    // of 15 statistically surfaced ~0 tradeable opportunities; 40 matches the
    // manual scanner's sweet spot.
    const scan = await runScan({
      limit: ap.scan_limit ?? 40,
      min_volume: 0,
      min_effective_edge: Math.min(ap.min_effective_edge_pct / 100, 0.07),
      max_days_to_resolution: ap.max_days_to_resolution,
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
          expiration_ts: Math.floor(Date.now() / 1000) + ORDER_EXPIRATION_SECONDS,
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
      const nearMisses = (scan.screened_out ?? [])
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
  //
  // Kelly assumes p is the TRUE probability. Ours is an LLM estimate blended
  // with a market price, carrying substantial unquantified error — and Kelly
  // is hypersensitive to error in p: overestimating by a few points turns
  // quarter-Kelly into effectively over-levered. So size from a conservative
  // LOWER BOUND on p, haircut by Claude's own stated confidence, rather than
  // from the point estimate.
  const b = (1 - price) / price
  const pRaw = opp.direction === 'YES' ? opp.p_shrunk : 1 - opp.p_shrunk
  const haircutPp =
    opp.confidence === 'HIGH' ? ap.kelly_haircut_high_pp
    : opp.confidence === 'MEDIUM' ? ap.kelly_haircut_medium_pp
    : ap.kelly_haircut_low_pp
  const p = Math.max(0.01, pRaw - (haircutPp ?? 0) / 100)
  const q = 1 - p
  const kellyFull = (p * b - q) / b
  if (!Number.isFinite(kellyFull) || kellyFull <= 0) {
    return skip(
      `Kelly criterion is non-positive after the ${haircutPp}pp ${opp.confidence}-confidence ` +
      `haircut (win prob ${(pRaw * 100).toFixed(1)}% → ${(p * 100).toFixed(1)}% at ${priceCents}¢)`
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
    },
  }
}
