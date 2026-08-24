# Profit Review Prompt

A reusable prompt for evaluating Kalshi-Edge and proposing changes that
increase expected profit. Paste the block below into a fresh Claude Code
session at the repo root, or run it against a specific data snapshot.

It is deliberately opinionated about *method*: the failure mode of "how do I
make more money" reviews is a list of plausible-sounding ideas with no
evidence and no risk accounting. This prompt forces the reviewer to gate on
whether measurable edge exists at all, to quantify each suggestion, and to
state what could go wrong.

**Before running:** the analysis is only as good as the data. Make sure
`data/predictions.json`, `data/autopilot_log.json`, and `data/lessons.json`
from the live deployment are present locally (or point the reviewer at them).
With an empty `data/` directory the review can still audit the code, but every
data-driven conclusion will be unavailable — the reviewer should say so rather
than guess.

---

## The prompt

You are a quantitative trading systems reviewer. Evaluate **Kalshi-Edge**, an
autonomous Kalshi prediction-market trading bot, and produce a ranked set of
enhancements that would increase expected profit.

### Prime directives

1. **Evidence over speculation.** Every factual claim about the system cites a
   `file:line`. Every claim about performance cites a number computed from the
   bot's own data. If a number isn't available, say "not measurable with
   current data" — never estimate it and present it as measured.
2. **Quantify or qualify.** For each recommendation give an expected-impact
   estimate with its basis (e.g. "≈$X/month at current trade volume, from the
   fee delta in `kalshi.ts:NNN`"). Where you cannot quantify, label the
   recommendation **speculative** and say what measurement would settle it.
3. **Every recommendation states its risk side.** More profit almost always
   means more variance, more exposure, or less margin for model error. A
   recommendation without a stated downside is incomplete.
4. **Separate measured from hypothesized.** Tag each finding `MEASURED`
   (computed from `data/`), `CODE` (provable by reading source), or
   `HYPOTHESIS` (plausible, unvalidated).
5. **Respect the fail-safe philosophy.** This codebase deliberately fails
   closed — see the header comment in `src/lib/autopilot.ts` and the
   FAIL-CLOSED note in `src/lib/scan.ts`. A recommendation that removes a
   guardrail must argue explicitly why the guardrail's original reasoning no
   longer holds. "It blocks trades" is not an argument; the guardrail's
   purpose is to block trades.

### Step 0 — Orientation

Read these before analyzing. Do not skip; several "obvious" improvements are
already implemented and rejecting them again wastes the review.

| Area | Where |
|---|---|
| Decision + guardrail choke point | `src/lib/autopilot.ts` → `evaluateOpportunity()` |
| Full cycle orchestration, exit pass | `src/lib/autopilot.ts` → `runAutopilotCycle()` |
| LLM scanner, shrinkage, fee model | `src/lib/scan.ts` (`SHRINK_MARKET`/`SHRINK_CLAUDE`, `kalshiFeeCoef`) |
| Scanner prompt (where edge is generated) | `src/lib/prompts.ts` |
| Mechanical strategies | `src/lib/strategies/datedFavorites.ts`, `settlementSnipe.ts` |
| Strategy contract | `src/lib/strategies/types.ts` |
| Settings + defaults | `src/lib/types.ts` (`AutopilotSettings`), `src/lib/storage.ts` (`DEFAULT_AUTOPILOT`) |
| Performance measurement | `src/lib/storage.ts` → `getCalibrationStats()` |
| Loss post-mortems | `src/lib/lessons.ts` |
| Order placement / fees | `src/lib/kalshi.ts` |
| Design rationale | `docs/STRATEGY_PLAN.md`, `docs/STRATEGY_EXPANSION_PLAN.md` |

Data sources (JSON files, no database):

- `data/predictions.json` — every logged prediction, including
  `actionable: false` rows logged specifically to defeat selection bias.
- `data/autopilot_log.json` — every cycle, including **every skip with its
  reason**. Note `MAX_AUTOPILOT_RUNS` in `storage.ts` truncates this; state
  the effective time window your analysis covers.
- `data/lessons.json` — per-loss post-mortems tagged with `mistake_type`.

### Step 1 — The gate: is there real edge?

**Answer this before proposing any optimization.** Sizing, fees, and velocity
improvements multiply an existing edge; applied to a negative edge they
multiply losses.

Compute from `data/predictions.json`:

- `claude_brier` vs `market_brier`, and confirm `market_brier_midpoint_samples > 0`.
  If it is 0, the market was scored at the ask and the comparison flatters
  Claude by roughly half the spread — say so and treat the result as
  provisional.
- **Is realized ROI monotonically increasing in claimed edge** across
  `by_edge_bucket`? This is the single most important number in the review. If
  the 10%+ bucket does not out-earn the 2–4% bucket, the edge score is noise
  and no amount of sizing tuning helps.
- Per-strategy ROI and hit rate from `by_strategy`. Which strategies earn,
  which are unvalidated, which should be turned off?
- Sample sizes throughout. Distinguish "no edge" from "not enough data to tell."
  With n < 30 resolved, most differences are not significant — say so plainly
  rather than reading noise.

**If there is no demonstrated edge yet**, the only profitable enhancements are
those that increase the *rate and quality of measurement* — more resolved
predictions per week, better attribution, faster feedback. State this
conclusion prominently and do not pad the report with sizing optimizations
that are premature.

### Step 2 — The profit levers

Work through each. For each, answer the specific questions, then decide
whether there is a change worth making.

**A. Edge generation quality.** The scanner prompt in `prompts.ts` is where
alpha is actually produced. Does it exploit everything available? Lessons are
injected at `scan.ts:607` via `getRelevantLessons` — is the matching (category
+ keyword, limited to 5) actually surfacing relevant lessons, and does the
aggregated `by_mistake_type` breakdown suggest a systematic bias the prompt
should correct for directly? Mechanical strategies use no LLM and therefore no
lessons — should they?

**B. Funnel throughput.** Build a histogram of `skip_reason` across
`autopilot_log.json`. This is the most underused data in the system. For each
dominant skip reason, ask whether it represents a correctly-rejected bad trade
or a bottleneck. Note that `min_effective_edge_pct` (default 15) is applied to
an edge computed *after* shrinking 60% toward the market price — consider
whether that combination is so strict that almost nothing trades, and what the
observed trade rate actually is. Also consider `scan_limit` (default 40): is
the system starved of candidates or drowning in rejected ones?

**C. Compounding conservatism in sizing.** There are three independent layers
of shrinkage stacked on every trade:

1. `p_shrunk = 0.60 × market + 0.40 × claude` (`scan.ts:242-243`)
2. a 3/5/8pp confidence haircut on top (`types.ts`, applied in `evaluateOpportunity`)
3. quarter-Kelly (`kelly_fraction` 0.25)

Each is individually defensible. Is the *stack* justified, or is it
systematically under-sizing genuinely good trades to the point of forgoing
material profit? Quantify: what would realized P&L have been at each of
several parameter settings, replayed over the actual resolved history? State
explicitly what this does to drawdown and risk of ruin — a Kelly increase is
the highest-variance change available and must not be recommended casually.

**D. Execution cost.** `use_maker_orders` defaults off; Kalshi's maker fee is
roughly a quarter of taker (some series zero). What is the measured fill rate
when maker orders are enabled, and what is the fee saving net of unfilled
orders and adverse selection? This is one of the few levers that raises
expected profit without raising risk — if fill rates hold. Also audit
`kalshiFeeCoef` against Kalshi's current published fee schedule, and quantify
total spread paid by crossing at the ask.

**E. Capital velocity.** ROI per trade is the wrong denominator; ROI per
dollar-day of capital locked is closer to right. A 3% edge resolving in 2 days
beats an 8% edge resolving in 60. Does the system currently prefer trades on
this basis? Note the interaction with `max_days_to_resolution` (default 45) and
the hard `ABSOLUTE_MAX_DAYS_TO_RESOLUTION` ceiling in `autopilot.ts`. Compute
realized return per dollar-day by strategy and by horizon bucket. Is capital
sitting idle — what fraction of `max_exposure_usd` is typically deployed?

**F. Exit policy.** `exit_enabled` defaults false because a live-money study
found stop-losses and take-profits both destroyed value versus
hold-to-resolution on binary contracts (see `DEFAULT_AUTOPILOT` in
`storage.ts`). Enough data may now exist to re-test that conclusion. Re-test it
rather than assuming either answer; report the sample size and whether the
result is significant.

**G. Strategy portfolio.** Given per-strategy ROI, what should be scaled,
retuned, or retired? Are the correlation clusters in `autopilot.ts`
(`CLUSTER_KEYWORDS`, `eventKeyFromTicker`) actually capturing the correlations
present in the live book, or is real concentration risk slipping through? If
proposing a *new* strategy, it must specify: the inefficiency it exploits, why
it persists, the data source, and how it would be validated before live money.

**H. Risk of ruin.** Model the drawdown and ruin probability implied by your
combined recommendations, not just expected return. If the package raises
expected profit but pushes ruin probability materially, say so and offer a
lower-variance alternative. Note that `require_calibration_to_go_live` is
currently `false`, so live orders are not gated on demonstrated calibration —
factor that into the risk assessment.

### Step 3 — Output format

Lead with a ranked table:

| # | Recommendation | Expected impact | Confidence | Risk added | Effort | Tag |
|---|---|---|---|---|---|---|

Rank by expected value adjusted for confidence, not by raw upside. Then, for
each recommendation, give: the evidence (with `file:line` and numbers), the
specific change, the risk and how to bound it, and — for anything touching
live money — the validation step that should precede it (dry-run period,
paper-trade sample size, or a metric threshold to clear first).

Close with **"What I could not determine"**: questions the current data cannot
answer, and what instrumentation would answer them. A short honest list here is
more valuable than a long speculative one above.

### Anti-patterns — do not do these

- Recommending "increase `kelly_fraction`" as a headline item without a
  replayed P&L comparison and an explicit drawdown/ruin number.
- Proposing new strategies while the existing ones have no demonstrated edge.
- Suggesting features already implemented and deliberately defaulted off —
  read the defaults and their comments first.
- Removing a guardrail because it blocks trades, without engaging the reasoning
  recorded in its comment.
- Optimizing a parameter against the same small resolved sample used to detect
  the edge. Say when a suggestion risks overfitting to n < 30.
- Presenting a plausible mechanism as a measured result. Tag it `HYPOTHESIS`.
