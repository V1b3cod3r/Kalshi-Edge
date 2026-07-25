# Kalshi Edge — Strategy Optimization Plan

Handoff document for implementation. Written after a review of the strategy
layer (not the plumbing). Each phase lists exact files, data shapes, and
verification steps.

**Read this first:** the phases are ordered by *dependency*, not by appeal.
Phase 1 is a gate. Until the measurement layer is fixed, every other change is
unfalsifiable — you will not be able to tell whether it helped, hurt, or did
nothing. Do not skip ahead to the "interesting" modeling work in Phase 3.

---

## Phase 0 — Preconditions (do before touching anything)

- [ ] Confirm `npm run build`, `npx tsc --noEmit`, and `npx vitest run` are all
      green on a clean checkout. Current baseline: **176 tests passing**.
- [ ] Confirm autopilot is in **dry-run** (`autopilot.dry_run = true`) for the
      duration of this work. Several phases change sizing and selection logic;
      none should touch real money until Phase 2 verification passes.
- [ ] Note: `require_calibration_to_go_live` was set to `false` at user request.
      Phase 1 makes that gate meaningful again — revisit turning it back on
      once real ROI data exists.

---

## Phase 1 — Fix the measurement layer  ⚠️ GATE — nothing else is valid without this

**Problem.** The system cannot currently answer "does Claude beat the market?"
Three independent flaws:

1. **Selection bias.** `scan.ts:751` logs a `Prediction` *only for
   opportunities that cleared the edge filter*. Markets Claude evaluated and
   priced fairly are never recorded. The Brier comparison is therefore computed
   on a sample selected by the very disagreement being validated — a zero-skill
   model still looks distinctive.
2. **Handicapped baseline.** `storage.ts:314` scores the market using
   `Prediction.market_price`, which is populated from `market.yes_price` — and
   `scan.ts:90` shows that is the **YES ask**, not the midpoint. Every
   observation hands Claude roughly half the spread as free advantage.
3. **Wrong metric.** Brier measures probabilistic calibration, not
   profitability. You can improve Brier and lose money.

### 1a. Log every evaluation, not just actionable ones

`src/lib/types.ts` — extend `Prediction`:

```ts
actionable: boolean        // true = cleared the edge filter (a real trade candidate)
market_yes_bid?: number    // for midpoint reconstruction
market_yes_ask?: number
confidence?: 'LOW' | 'MEDIUM' | 'HIGH'   // needed by Phase 2
```

`src/lib/scan.ts` (~line 751) — currently iterates `opportunities`. Change to
iterate **`scored`** (the pre-filter array, line 656) so fairly-priced markets
are logged too, with `actionable: false`. Keep the existing pending-ticker
dedupe. Keep the `logPredictions` flag semantics unchanged.

Backfill consideration: existing rows have no `actionable` field. Treat
`undefined` as `true` (they were all actionable under the old logic) so
historical data isn't silently reclassified.

### 1b. Score the market at midpoint, not at the ask

`src/lib/scan.ts` — `normalizeMarket` currently discards the bid after
deriving prices. Capture `yes_bid`/`yes_ask` onto `MarketInput` and persist
them on the `Prediction`.

`src/lib/storage.ts` `getCalibrationStats()` (~line 308) — compute market Brier
from `(yes_bid + yes_ask) / 2` when both are present; fall back to
`market_price` for legacy rows, and **exclude legacy rows from the headline
comparison** rather than mixing two different baselines.

### 1c. Make realized ROI the primary metric

Add to `CalibrationStats`:

```ts
by_edge_bucket: Array<{
  bucket: string          // '0-2%', '2-4%', '4-6%', '6-10%', '10%+'
  count: number
  resolved: number
  claimed_edge_avg: number
  realized_roi_pct: number | null   // Σ profit / Σ cost, from settlements
  hit_rate: number | null
}>
```

Join predictions to settlements by ticker. `settlementProfitDollars()` already
exists in `kalshi.ts` — reuse it, do not reimplement.

Surface this table on the Calibration page **above** the Brier box. The
question it answers — "when we claimed 4–6% edge, what did we actually earn per
dollar risked?" — is the one that decides whether to trade at all.

**Verification:** run a scan, confirm `predictions.json` now contains
`actionable: false` rows. Confirm the edge-bucket table renders with
`resolved: 0` and doesn't crash on an empty join.

**Caveat to surface in the UI:** `settlementProfitDollars()` computes profit
from cost/fee fields because Kalshi's V2 settlements response has no direct
profit field. That formula has **never been checked against a real settled
trade**. First time a settlement lands, compare the app's number to Kalshi's own
history before trusting any ROI figure built on it.

---

## Phase 2 — Confidence-weighted Kelly haircut (cheap, immediate risk reduction)

**Problem.** `autopilot.ts:575` computes full Kelly from `p_shrunk`, then
applies `kelly_fraction` (0.25). Kelly assumes `p` is the *true* probability;
`p_shrunk` is an LLM estimate blended with a price, carrying substantial
unquantified error. Kelly is hypersensitive to error in `p` — overestimating by
a few points converts quarter-Kelly into effectively over-levered.

**Change.** Size from a conservative lower bound on `p`, not the point estimate.
`ScanOpportunity` already carries `confidence` (`scan.ts:262`), currently unused
for sizing.

`src/lib/autopilot.ts` `evaluateOpportunity()`, before the Kelly block:

```ts
const CONFIDENCE_HAIRCUT_PP = { HIGH: 3, MEDIUM: 5, LOW: 8 }  // percentage points
const pRaw = opp.direction === 'YES' ? opp.p_shrunk : 1 - opp.p_shrunk
const p = Math.max(0.01, pRaw - CONFIDENCE_HAIRCUT_PP[opp.confidence] / 100)
```

Make the three haircut values settings (`AutopilotSettings`) so they're tunable
from the guardrails UI without a redeploy, defaulting as above.

Expect this to **reduce** trade frequency and size. That is the intent — it is a
safety change, not an alpha change. Do not "fix" the reduction by loosening
thresholds elsewhere.

**Verification:** unit-test that a LOW-confidence opportunity sizes strictly
smaller than an otherwise-identical HIGH-confidence one, and that a marginal
opportunity can be haircut below the 1-contract floor (correctly skipped).

---

## Phase 3 — Mechanical probability models (the real alpha)

**Rationale.** Weather and index/crypto range markets have *closed-form*
answers. Currently these feed Claude as prose and get judged by vibes. Computing
them in code and handing Claude a model probability to adjust turns the weakest
categories into the most rigorous ones. Mechanical edges are the kind that
survive.

### 3a. Weather (highest confidence, start here)

`src/lib/signals.ts` already fetches NWS forecasts and resolves the city from
`KXTEMP<CITY><H|L>` ticker codes. The forecast gives a point estimate; the
market asks P(temp > threshold).

- Parse the threshold from the ticker (e.g. `-T74.99` → 74.99) and the
  high/low leg from the `H`/`L` suffix.
- Model: `P(high > T) = 1 - Φ((T - forecast) / σ)`.
- σ from NWS forecast error by lead time — roughly 2–3°F at 1–2 days, widening
  to 5–6°F at 5–7 days. **Verify these against a real error table rather than
  taking them from this document**; a wrong σ silently miscalibrates everything
  downstream.
- Emit as a `Signal` labeled clearly as a model output, e.g.
  `"Model P(YES) = 0.72 (NWS high 78°F vs threshold 74.99°F, σ=3°F, 2d lead)"`.

### 3b. Index / crypto ranges

`yahooOHLC()` (`signals.ts:73`, currently module-private — export it) already
supplies closes for `^GSPC`, `^IXIC`, BTC/ETH/SOL.

- Realized vol: stdev of log returns over 30d, annualized.
- Terminal probability: lognormal,
  `P(S_T > K) = Φ((ln(S/K) + (−σ²/2)T) / (σ√T))`.
- For "touch any time before expiry" markets the terminal formula is **wrong** —
  use the reflection-principle barrier formula, roughly `2 ×` terminal for an
  at-the-money barrier. Getting this backwards materially misprices; if unsure,
  restrict to terminal-style markets first.

### 3c. Wiring

Add the model probability as an explicit, labeled input in
`buildScannerUserMessage` / `buildAnalysisUserMessage` (`src/lib/prompts.ts`),
and instruct Claude to **start from the model probability and adjust only for
factors the model cannot see** (breaking news, resolution-criteria quirks).

Consider (design decision, discuss before building): where a model probability
exists, blend it into `p_shrunk` alongside the market price and Claude's
estimate, rather than letting Claude's judgment override a closed-form answer.

**Verification:** back-test against resolved markets in `predictions.json` once
Phase 1 has accumulated data. A model probability that doesn't beat Claude's
estimate on its own category isn't ready to ship.

---

## Phase 4 — Execution quality (orderbook awareness)

**Problem.** Orders are placed at the ask, blind to depth. On a 4pp edge,
crossing an extra 2¢ of spread destroys half the profit. There is currently **no
orderbook fetch anywhere in the codebase** (`kalshi.ts` has none).

- Add `getOrderbook(auth, ticker)` to `src/lib/kalshi.ts`, using the same
  `fetchWithRetry` + `getSignedHeaders` pattern as neighbouring functions.
  **Verify the V2 path and response shape against live Kalshi docs before
  implementing** — this project has already been bitten twice by V2 schema
  changes (order creation moved to `/portfolio/events/orders`; positions
  renamed `position` → `position_fp`). Assume nothing.
- Use it to (a) reject opportunities where depth at the target price can't fill
  the intended size, and (b) optionally rest orders 1¢ inside the spread on thin
  markets instead of crossing.
- Note the tradeoff: resting improves fill price but risks non-fill. Autopilot
  currently sends `immediate_or_cancel` when `expiration_ts` is set
  (`kalshi.ts` `toV2OrderBody`). Resting means changing that — and stale resting
  orders are what `reconcileStaleOrders()` already exists to clean up.

---

## Phase 5 — Event-driven timing

Scheduled-release edge (CPI, FOMC, jobs) is largest in the hours *before* the
release, when casual money is stalest relative to nowcasts. Autopilot currently
scans uniformly, including at 3 AM when nothing is happening.

- `src/lib/calendar.ts` and the FOMC calendar in `signals.ts` already hold the
  release schedule.
- Add an optional "event window" mode: concentrate cycles in the N hours before
  a scheduled release rather than firing on a flat interval.
- Cheap prerequisite already satisfied: the 30-minute scan cache means extra
  cycles during quiet periods cost nothing, so this is about *concentrating*
  attention, not adding volume.

---

## Phase 6 — Correlation clustering by event, not string prefix

**Problem.** `clusterForTicker()` (`autopilot.ts`) matches keywords, then falls
back to the first 4 characters of the ticker. Two markets on the same underlying
event with different prefixes count as independent — you could hold 4 positions
that are effectively one bet, and `max_per_cluster_usd` would not notice.

- Kalshi markets carry an `event_ticker`; markets sharing one are near-perfectly
  correlated. **Verify it is present on the market objects the scan actually
  fetches** (it is a documented request param in `fetchMarkets`; presence on the
  *response* needs confirming against live data).
- Capture it on `MarketInput` (`types.ts:164`) and `ScanOpportunity`, and prefer
  it as the cluster key, keeping the keyword map as fallback for cross-event
  correlation (e.g. all rates markets).

---

## Phase 7 — Re-tune shrinkage from data (last, not first)

**Do not touch these constants until Phase 1 has produced real ROI data.**

Current state: `SHRINK_MARKET = 0.60`, `SHRINK_CLAUDE = 0.40` — a guess with no
empirical basis. Measured consequence (verified by calculation):

| Threshold | Required Claude-vs-market disagreement @ 50¢ |
|---|---|
| Scanner, 2.5% | **~10.6 pp** |
| Autopilot, 4% | **~14.4 pp** |

Meanwhile `prompts.ts:237` instructs Claude to treat the market price as its
prior and deviate only with specific justification. **The system tells the model
to agree with the market, then only trades when it wildly disagrees.** The
survivors of that filter skew toward cases where Claude is confidently wrong.

Two things to resolve *with data*, not opinion:

1. Whether the anti-anchoring prompt instruction and aggressive shrinkage should
   both be active simultaneously.
2. The shrinkage constant itself — once `by_edge_bucket` shows realized ROI by
   claimed edge, the optimal blend is *fittable* rather than guessed.

---

## Anti-goals — things NOT to do

- **Don't loosen thresholds to increase trade count.** Rare trades are the
  correct behavior for a system with unproven edge. Low volume is a symptom to
  diagnose, not a bug to fix.
- **Don't tune shrinkage before Phase 1.** You'd be fitting to noise.
- **Don't add new signal sources** until the existing ones (NWS, Cleveland Fed,
  BLS, Polymarket) are converted from prose context into actual probabilities.
  Breadth of inputs is not the bottleneck; use of them is.
- **Don't re-enable live trading** until Phase 1 + Phase 2 verification pass and
  the edge-bucket table shows positive realized ROI on a meaningful sample.

---

## Suggested sequencing

| Order | Phase | Why here |
|---|---|---|
| 1 | Phase 1 — measurement | Gate. Everything downstream is unfalsifiable without it. |
| 2 | Phase 2 — Kelly haircut | Cheap, immediate risk reduction, independent of data. |
| 3 | Phase 3a — weather model | Highest-confidence mechanical edge; proves the pattern. |
| 4 | Phase 4 — orderbook | Needed before scaling size, regardless of edge quality. |
| 5 | Phase 3b, 5, 6 | Incremental once the loop is measurable. |
| 6 | Phase 7 — shrinkage | Requires accumulated data. Genuinely last. |

## Open questions for the user

1. **Existing 2029–2035 positions** — sell to free capital, or let them ride?
   They still occupy `max_open_positions` slots and are re-evaluated by the exit
   pass every cycle.
2. **Phase 3c blending** — should a closed-form model probability override
   Claude's judgment where both exist, or only inform it?
3. **Phase 4 resting orders** — accept non-fill risk for better fill price, or
   keep immediate-or-cancel simplicity?
