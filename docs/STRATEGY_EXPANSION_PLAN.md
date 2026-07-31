# Kalshi Edge — Strategy Expansion Plan (Strategies 1–4)

Follow-up to `STRATEGY_PLAN.md`. That document fixed the measurement layer and
the LLM-divergence engine's worst bugs; this one is about the next question:
**should the LLM be the only thing deciding trades at all?**

Three independent research passes (Kalshi fee/edge economics, LLM forecasting
literature, LLM calibration studies — see the session that produced this doc)
converged on the same conclusion: general-purpose LLM probability estimation
is, at best, unproven against liquid market prices, and at worst actively
loses money (a live-money experiment: six frontier models traded real Kalshi
capital for 57 days and every one lost, −16% to −31%). Meanwhile several
**mechanical, non-forecasting edges** are directly supported by measurement —
either published academic work or arithmetic on data this app already has.

This plan turns those mechanical edges into strategies that run *alongside*
the LLM scanner, not instead of it, through a shared **strategy registry** so
every strategy's real performance is measured on equal footing.

**Verification caveat, stated once, applies everywhere below:** the specific
numbers cited (calibration slopes, ECE figures, bias magnitudes) came from a
research pass that could not reach primary sources directly (arXiv, journal
sites) and relied on search-engine summaries. Treat every cited number as
"directionally right, unverified in the primary source" — this is why every
strategy below ships **disabled by default** and every model-derived
probability is deliberately conservative/capped rather than taken at face
value.

---

## Architecture: the strategy registry

**Problem with the current shape.** `autopilot.ts` has exactly one opportunity
source (`runScan`, the LLM divergence engine) hard-wired into the guardrail
and sizing pipeline. Adding a second idea today means duplicating the
guardrail/Kelly/logging code inside a new bespoke code path — which is exactly
how the position-field bug and the fee-coefficient bug independently recurred
across three files earlier this project.

**The fix.** Generalize the pipeline's input from "one `ScanOpportunity[]`
array" to "opportunities from N strategy sources, each tagged with its
origin," flowing through the *same* `evaluateOpportunity` guardrail/Kelly
function and the *same* trade log. Concretely:

```
src/lib/strategies/
  types.ts            — StrategyOpportunity (the common shape every strategy emits)
  datedFavorites.ts    — Strategy 2 (below)
  settlementSnipe.ts    — Strategy 1 (below)
```

`StrategyOpportunity` is intentionally close to the existing `ScanOpportunity`
shape so `evaluateOpportunity` needs almost no changes — just a `strategy:
string` tag added to every skip/trade record it returns, and to every
`Prediction` autopilot logs. That tag is the entire mechanism for **per-
strategy P&L attribution**: once trades and predictions carry it, "which of my
edges actually earns money" becomes a `GROUP BY strategy` over data that
already exists, not a new subsystem.

Each strategy is enabled/disabled independently in `AutopilotSettings`. The
LLM scanner becomes `strategy: 'llm-divergence'` — formalized as one entry in
the registry, not special-cased, but **on by default** (preserves existing
behavior; nothing about running it changes).

---

## Strategy 1 — Settlement sniping (implement this session)

**Thesis.** Kalshi's daily weather markets settle on an official climate
report published hours after the day's temperature extreme has already
happened — a "high" cannot un-peak. Live weather observations (METAR, via
NWS's free public API) report that extreme in near-real-time. In the gap
between "physically decided" and "officially settled," a market can trade at
90–95¢ when the true probability, conditional on the observation, is closer
to 97–99%. This requires no forecasting — the outcome is (almost) already
public.

**Why "almost."** The official Daily Climate Report occasionally differs from
preliminary station observations by a degree — that disagreement rate is
exactly why the market isn't already pricing this at $1, and exactly why this
strategy must stay conservative rather than assume certainty.

**Data source.** NWS API (`api.weather.gov`), free, no key:
1. `/points/{lat,lon}` → nearest forecast office + grid, and a station list.
2. `/stations/{stationId}/observations?start=<local-midnight-UTC>` → today's
   observations for that station (GeoJSON features, `temperature.value` in
   °C).
3. Take max (for `...H` high-temp markets) or min (`...L` low-temp markets)
   of today's observations so far.

**Scope, deliberately narrow for this pass:**
- Only tickers matching the *confirmed* `KXTEMP<CITY><H|L>` prefix already in
  `signals.ts`'s `TEMP_TICKER_CITY_CODES` (currently NYC, LAX only — same
  "don't guess unverified station codes" discipline as the existing forecast
  signal).
- Only markets whose ticker's threshold segment parses cleanly as `T<number>`
  (a simple "above/below X" contract). Range-bucket or other formats are
  skipped, not guessed at.
- **Direction is never assumed from the ticker.** The market title must
  independently corroborate the comparison direction (contains "above" /
  "exceed" / "over" / ">" for a high-side bet, or "below" / "under" / "<" for
  a low-side bet). If the title doesn't clearly corroborate, skip the market
  entirely. Getting a near-certainty bet's *direction* wrong is the single
  worst failure mode this strategy could have — it would size aggressively
  into a confidently wrong trade — so direction confirmation is a hard gate,
  not a heuristic.
- Only fires when the observed extreme clears the strike by a **safety
  margin** (default 2°F, configurable), to absorb the prelim-vs-official
  divergence risk.
- The resulting probability estimate is **capped** (default 0.95, never
  0.99+) regardless of how far the observation clears the strike — same
  reasoning.
- Only considers markets resolving **today** (by `resolution_date`), so a
  stale observation can never be read against tomorrow's market.

**Risk this does NOT cover:** station outages, a genuinely disputed/delayed
climate report, or Kalshi settling against a different station than the one
queried. This is why it's capped, margin-gated, and off by default at
shipping.

---

## Strategy 2 — Dated favorites (implement this session)

**Thesis.** The largest study in this space (292M trades, Kalshi +
Polymarket) found market calibration is close to perfect within an hour of
resolution but degrades with horizon: a favorite priced around 70–75¢ a month
before resolution tends to be *underpriced* relative to its true probability.
Kalshi's own transaction-level economics data (300k+ contracts) independently
shows contracts priced above 50¢ earn small positive average returns, while
sub-10¢ longshots lose the large majority of money invested. Both point the
same direction: **buy moderate-to-strong favorites, dated out a few weeks,
hold to resolution.**

**Mechanical rule, no LLM:**
- Scan open markets for whichever side (YES or NO) has an ask price in a
  configurable favorite band (default 65–90¢).
- Only consider markets resolving in a configurable window (default 14–56
  days) — long enough for the horizon-miscalibration effect to matter, short
  enough to keep capital velocity and calibration feedback reasonable
  (consistent with the existing 45-day autopilot horizon default elsewhere).
- Compute a **conservative horizon-corrected probability**: model the
  miscalibration as extremization in logit space,
  `p_true = sigmoid(logit(price) × slope)`, where `slope` ramps from 1.0 at 0
  days to a capped maximum (default 1.15, well under the ~1.32 the research
  cited — deliberately kept conservative given the verification caveat above)
  as days-to-resolution grows toward the window's far edge. This is a
  **named, tunable constant** (`DATED_FAVORITES_MAX_SLOPE`), not a magic
  number buried in logic — re-tune it from your own backtest once you have
  one, not from the cited paper.
- `edge_pct` and Kelly sizing flow through the exact same
  `evaluateOpportunity` guardrail path as every other strategy — same fee
  subtraction, same cluster caps, same daily-spend limits, same Kelly
  confidence haircut. No new sizing logic, on purpose: this strategy earns
  its edge from selection, not from a separate risk model.

**What this deliberately does NOT do:** it does not read resolution criteria,
does not check for ambiguity, does not weight by category. It is a pure price
× horizon filter. Category-specific effects (the research separately found
Fed/rate markets are almost perfectly calibrated with no bias, while
unemployment markets show the largest documented mispricing) are a natural
follow-up refinement — track it as a v2, don't build it blind now.

---

## Strategy 3 — Monotonicity repair (design only, not this pass)

**Thesis.** Within one event's strike ladder ("high > 70° / > 72° / > 74°"),
prices must be monotonically non-increasing in strike — P(X>74) can never
exceed P(X>72). Kalshi's orderbook occasionally violates this on thin/stale
legs. Unlike a full-ladder sum-arbitrage (which needs every leg to fill and
gets eaten by N-legs-worth of fees), a monotonicity violation needs only
**one** trade on the mispriced leg relative to its more-liquid neighbor —
single fee, not N.

**Why not this pass.** This wants the orderbook endpoint
(`GET /markets/{ticker}/orderbook`), which this codebase has never called —
the existing scan pipeline only reads the flat top-of-book `yes_ask`/`yes_bid`
fields from the markets list endpoint. Confirming the orderbook endpoint's
actual auth requirements and response shape against a live account (auth
status was reported as disputed by two different sources during research —
one says signed headers required, another reports success unauthenticated)
needs a dedicated verification pass, not a guess baked into money-moving code.

**When picked up:** add `getOrderbook(auth, ticker)` to `kalshi.ts`, verify
its shape via one live authenticated call and a couple of unit tests locking
the response mapping, then build the ladder-grouping (by `event_ticker`,
already captured on every `MarketInput`) and the pairwise-monotonicity check
as a new registry strategy — same pattern as strategies 1–2, no LLM.

---

## Strategy 4 — Release-time reaction (design only, not this pass)

**Thesis.** `calendar.ts` already tracks CPI/jobs/Fed/GDP release dates,
street consensus, and — confirmed by re-reading the code for this plan — the
Trading Economics feed populates the **actual** print once released
(`releaseToSignal` already prefers `r.actual` over `r.consensus` when
present). Documented research found markets underreact to fresh public
information (moving roughly 0.64-for-one against a reference model on
newly-public info), and that underreaction persists for minutes, not seconds.
The number is public to everyone simultaneously; the edge is in the market's
adjustment lag, not in insight.

**Why not this pass.** This needs a fundamentally different trigger than
everything else in this app. Every existing strategy runs on the periodic
autopilot cycle (user-triggered or on a 15–60 minute interval); this one needs
to wake at an exact scheduled second (8:30:00am ET on release days) and act
within a narrow window, which is a different piece of infrastructure (a
cron-style trigger, not a polling loop) and deserves its own design pass
rather than being wedged into the existing cycle shape.

**When picked up:** add a scheduled trigger keyed off `calendar.ts`'s known
release dates/times, a fast-path that re-fetches the calendar at T+0 for the
actual print, a resolution-mapping step (which strikes does this print
resolve or nearly-resolve), and a comparison against current — not scan-time-
stale — market prices. No LLM call belongs in the critical path; speed is the
entire edge.

---

## Phasing for this session

| Phase | Scope |
|---|---|
| A | Strategy registry architecture (types, `evaluateOpportunity` generalization, `strategy` tag on trades/predictions) |
| B | Dated Favorites strategy, off by default |
| C | Settlement Sniping strategy, off by default |
| D | Per-strategy P&L attribution in `getCalibrationStats` (`by_strategy` breakdown) |
| E | Settings + UI toggles, tests, full verification |

Strategies 3 and 4 are deliberately **not** built this session — both need a
verification step (live orderbook auth, or a new scheduling primitive) that
shouldn't be guessed at in code that places real orders. They're documented
here so the registry architecture from Phase A is built to accept them
without another refactor.
