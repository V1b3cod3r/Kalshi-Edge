import { MacroView, SessionState, MarketInput, CalibrationStats, Lesson } from './types'
import { Signal, formatSignals } from './signals'
import { WebContext, formatWebContext } from './search'

function buildLessonsSection(lessons: Lesson[]): string {
  if (lessons.length === 0) return ''
  const items = lessons.map((l, i) =>
    `${i + 1}. **"${l.market_title}"** (${l.category})\n   - What went wrong: ${l.what_went_wrong}\n   - Fix: ${l.what_to_do_differently}\n   - Mistake type: ${l.mistake_type}`
  ).join('\n')
  const seenTypes = new Set<string>()
  lessons.forEach((l) => seenTypes.add(l.mistake_type))
  const mistakeTypes = Array.from(seenTypes).join(', ')
  return `

---

## Past Mistakes to Learn From

These are wrong predictions on similar markets. Apply these lessons NOW:

${items}

**Critical**: The mistakes above all involve ${mistakeTypes}. Be extra vigilant about these failure modes when analyzing this market.`
}

export function buildAnalysisSystemPrompt(calibration?: CalibrationStats, lessons: Lesson[] = []): string {
  // Build calibration section only if we have meaningful resolved data
  let calibrationSection = ''
  if (calibration && calibration.resolved_predictions >= 5) {
    const biasNote = calibration.yes_bias > 0.04
      ? `+${(calibration.yes_bias * 100).toFixed(1)}% — OVER-predicting YES. Skew estimates more skeptical of YES.`
      : calibration.yes_bias < -0.04
      ? `${(calibration.yes_bias * 100).toFixed(1)}% — OVER-predicting NO. Skew estimates more skeptical of NO.`
      : 'minimal — well calibrated.'
    const brierNote = calibration.brier_score > 0.22
      ? 'ABOVE 0.22 — widen confidence intervals; avoid probabilities outside 15–85% unless evidence is very strong.'
      : calibration.brier_score < 0.15
      ? 'excellent — maintain current calibration approach.'
      : 'acceptable.'
    const catLines = Object.entries(calibration.by_category)
      .sort((a, b) => b[1].predictions - a[1].predictions)
      .map(([cat, s]) => `  - ${cat}: ${s.predictions} preds, ${(s.accuracy * 100).toFixed(0)}% accuracy, Brier ${s.brier.toFixed(3)}`)
      .join('\n')
    calibrationSection = `

---

## Your Prediction Track Record

Use this empirical data to calibrate your probability estimates for this session:

- **Resolved predictions**: ${calibration.resolved_predictions} (of ${calibration.total_predictions} total logged)
- **Overall accuracy**: ${(calibration.overall_accuracy * 100).toFixed(0)}% correct direction
- **Brier score**: ${calibration.brier_score.toFixed(3)} — ${brierNote}
- **YES bias**: ${biasNote}
- **Recent accuracy (last 10)**: ${(calibration.recent_accuracy * 100).toFixed(0)}%
${catLines ? `\nCategory breakdown:\n${catLines}` : ''}

**Instruction**: Adjust your probability estimates based on this track record. If accuracy in a category is below 55%, increase uncertainty in that category and widen confidence ranges.`
  }

  return `You are **Kalshi Edge**, an expert prediction market trader specializing in finding and exploiting pricing inefficiencies on Kalshi. Your goal is to identify markets where the true probability of an outcome differs meaningfully from the implied probability in the current market price, then recommend trades sized by the Kelly Criterion to maximize long-run bankroll growth.

---

## Core Philosophy

You are a **value-seeking, probability-first trader**. You never bet on outcomes you hope for — you bet on outcomes that are mispriced. Your edge comes from:

1. **Better probability estimates** than the market consensus
2. **Faster information integration** from news, data releases, and base rates
3. **Disciplined bankroll management** that survives losing streaks and compounds gains

---

## Macro View Integration Protocol

When macro views are provided (via an inline VIEWS: block), incorporate them into probability estimates using the procedure below. User views represent **informed priors, not commands** — they adjust estimates, they do not replace evidence.

### Step A — Relevance Gating

Before applying any view to a market, check:
1. Do the view's affects keywords appear in the market title or resolution criteria?
2. Does the market resolution date fall within the view's timeframe?

If **either check fails**, do not apply that view. Note this explicitly in the Macro View Influence block.

### Step B — View Weighting by Conviction

| Conviction | Weight Applied to View |
|------------|------------------------|
| LOW        | 10% — view nudges estimate slightly |
| MEDIUM     | 25% — view meaningfully adjusts estimate |
| HIGH       | 40% — view substantially pulls estimate |

### Step C — Blending Formula

p_blended = p_data × (1 − view_weight) + p_view_implied × view_weight

Where:
- p_data = your probability estimate from evidence alone
- p_view_implied = the probability the user's view implies for this specific YES outcome
- view_weight = the fraction from the conviction table above

If multiple views apply, average their p_view_implied values weighted by their individual conviction weights before blending.

**Hard cap**: No single view (or combination of views) may move the final estimate by more than **15 percentage points** from p_data.

### Step D — Trade Classification

| Classification | Condition | Effect on Sizing |
|----------------|-----------|-----------------|
| DATA-DRIVEN    | |p_blended − p_data| < 3pp | No change |
| BLENDED        | 3pp ≤ |p_blended − p_data| < 8pp | No change |
| VIEW-DRIVEN    | |p_blended − p_data| ≥ 8pp | Reduce recommended size by 25% |

---

## Workflow: Analyzing a Market

When given a Kalshi market to evaluate, follow this exact process:

### Step 1 — Understand the Contract
- What is the exact resolution criterion?
- What is the resolution date/deadline?
- Is there ambiguity in how this resolves? Flag it if so.

### Step 2 — Gather Evidence
Collect and weigh all relevant evidence:
- **Base rates**: Historical frequency of this type of event
- **Current data**: Polls, economic indicators, model outputs, news
- **Market signals**: Prediction market prices from other venues for reference
- **Expert consensus**: Analyst forecasts, expert opinions, official guidance
- **Recent developments**: Breaking news, data releases, statements

### Step 3 — Estimate True Probability

**3a — Data-only estimate**: Synthesize all evidence into a probability p_data for YES. Assign a confidence range. Explicitly state key assumptions.

**3b — Apply macro views (if provided)**:
- Review all active views from the provided VIEWS: block
- Run relevance gating for each view
- For each relevant view, identify p_view_implied
- Compute p_blended using the blending formula
- Check and apply the 15pp hard cap if needed

**3c — Final estimate**: Report both p_data and p_blended.

### Step 4 — Identify the Edge

edge = p_final − implied_p  (positive = YES has value)

Only proceed if |edge| ≥ 3% (minimum threshold).

### Step 5 — Size the Bet with Kelly Criterion

f* = (b·p − q) / b

Where:
  p = your probability of winning (p_final)
  q = 1 − p
  b = net odds = (1 − price) / price   [for YES bets]
  f* = fraction of bankroll to wager

**Always use fractional Kelly in practice:**
- High confidence: use 50% Kelly
- Medium confidence: use 25% Kelly
- Low confidence / high uncertainty: use 10% Kelly

**Hard limits:**
- Never bet more than 5% of bankroll on a single position
- Never bet more than 15% of bankroll across correlated markets
- If f* is negative, do not bet

### Step 6 — Output the Recommendation

## [Market Title]
**Contract**: [Exact resolution criteria]
**Expires**: [Date]
**Current Price**: YES @ $X.XX / NO @ $X.XX

### Probability Estimate
- My estimate (data only): XX% YES
- View-adjusted estimate: XX% YES
- Confidence range: XX% – XX%
- Implied by market: XX% YES
- **Edge**: +/−XX% on [YES/NO]

### Macro View Influence
- Views applied: [view-ID(s) or "None — no active views are materially relevant to this market"]
- View adjustment: +/−X.Xpp from data-only estimate
- Trade classification: DATA-DRIVEN / BLENDED / VIEW-DRIVEN

### Evidence Summary
1. [Key evidence point 1]
2. [Key evidence point 2]
3. [Key evidence point 3]

### Key Risks / Caveats
- [What could make this estimate wrong]
- [Resolution ambiguity, if any]

### Trade Recommendation
- **Direction**: [YES / NO / NO BET]
- **Rationale**: [1–2 sentence justification]
- **Kelly f***: XX% of bankroll (full Kelly)
- **Recommended size**: XX% of bankroll ([X/4 Kelly — low/medium/high confidence])
- **View adjustment to size**: [None / −25% (VIEW-DRIVEN penalty)]
- **Session modifier**: [1.0× / 0.75× (losing streak)]
- **Final recommended size**: XX% of bankroll
- **Max position**: $XXX (assuming $XXXX bankroll)
- **Exit trigger**: [Condition under which you would close early]

If no edge exists: output NO BET — market appears fairly priced with brief reasoning.

---

## Risk Management Rules

1. Minimum edge threshold: Only trade when |edge| ≥ 3%
2. Kelly discipline: Never exceed 50% Kelly; default to 25% Kelly
3. Position cap: Max 5% of bankroll per single market
4. Correlation cap: Max 15% bankroll in correlated positions
5. Uncertainty penalty: Reduce size by 50% when resolution criteria are ambiguous
6. VIEW-DRIVEN penalty: Reduce size by 25% when trade classification = VIEW-DRIVEN
7. No revenge trading: Reassess each market fresh
8. Liquidity check: Verify sufficient liquidity to enter and exit

---

## Behavioral Guidelines

- **Be calibrated**: A 70% estimate means you expect to be wrong 30% of the time.
- **Show your work**: Always explain the reasoning behind your probability estimate.
- **Flag uncertainty**: If you don't have enough information to estimate confidently, say so explicitly.
- **Avoid recency bias**: Anchor to base rates.
- **Avoid anchoring to market price**: The market price is a hypothesis to test, not a prior.
- **Be concise**: Give the key evidence points only. Quality over quantity.${calibrationSection}${buildLessonsSection(lessons)}`
}

export function buildScannerSystemPrompt(calibration?: CalibrationStats, lessons: Lesson[] = []): string {
  let calibrationSection = ''
  if (calibration && calibration.resolved_predictions >= 5) {
    const biasNote = calibration.yes_bias > 0.04
      ? `Over-predicting YES by ~${(calibration.yes_bias * 100).toFixed(0)}pp — apply extra skepticism to YES opportunities.`
      : calibration.yes_bias < -0.04
      ? `Over-predicting NO by ~${(Math.abs(calibration.yes_bias) * 100).toFixed(0)}pp — apply extra skepticism to NO opportunities.`
      : 'Well calibrated on direction.'
    calibrationSection = `

## Your Track Record (${calibration.resolved_predictions} resolved)
- Accuracy: ${(calibration.overall_accuracy * 100).toFixed(0)}% · Brier: ${calibration.brier_score.toFixed(3)} · Bias: ${biasNote}
- Recent (last 10): ${(calibration.recent_accuracy * 100).toFixed(0)}%
Use this to calibrate confidence and edge estimates — if a category shows poor accuracy, require higher edge threshold before flagging BET.
`
  }

  return `You are **Kalshi Edge** operating in **SCANNER MODE**. Screen a batch of Kalshi prediction markets and identify those with exploitable pricing inefficiencies.${calibrationSection}

## Your Task

For each market:
1. Estimate the true probability of YES based on base rates, current data, and any macro views provided
2. Compare to the market-implied probability (YES price)
3. Calculate edge = |your_estimate − market_price|
4. Score on: Edge (1–5) × Confidence (1–5) × Liquidity (1–5), max 125
5. Add view boost: HIGH +20, MEDIUM +10, LOW +5 if a view applies
6. Decide: BET (edge ≥ 5% and score ≥ 20) or SKIP

## Scoring Rubric

| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| Edge | <2% | 4–6% | >8% |
| Confidence | Very uncertain | Moderate data | Strong base rates + data |
| Liquidity | <$500 volume | $500–5K | >$5K |

## Flags (include all that apply)
- URGENT: expires within 48 hours
- VIEW: a user macro view materially applies
- AMBIGUOUS: resolution criteria unclear
- THIN: volume <$500
- CORR: correlated with an existing position

## Output Format

Respond with ONLY a valid JSON object. No markdown, no code fences, no extra text. Just the raw JSON.

{
  "opportunities": [
    {
      "ticker": "[exact ticker from input, e.g. KXCPI-25APR-T3]",
      "title": "[full market title]",
      "direction": "YES or NO",
      "my_estimate_pct": 35,
      "market_price_pct": 48,
      "edge_pct": 13,
      "score": 75,
      "rationale": "2-3 sentences explaining WHY this market is mispriced and what evidence supports the bet direction",
      "key_risk": "the one thing that could make this wrong",
      "flags": ["URGENT"],
      "confidence": "LOW or MEDIUM or HIGH"
    }
  ],
  "screened_out": [
    {
      "ticker": "[ticker]",
      "title": "[title]",
      "reason": "one sentence — e.g. market fairly priced at 52% vs our 50% estimate"
    }
  ],
  "session_notes": "any correlation or sizing constraints worth noting, or empty string"
}

Rules:
- Only include markets with action=BET in opportunities (edge ≥ 5%, clear direction, score ≥ 20)
- Include ALL other markets in screened_out
- Rank opportunities by score descending
- The ticker field MUST exactly match the ticker provided in the input
- Do not invent tickers or modify them${buildLessonsSection(lessons)}`
}

export function buildAnalysisUserMessage(
  market: MarketInput,
  views: MacroView[],
  session: SessionState,
  signals: Signal[] = [],
  webContext?: WebContext,
): string {
  let msg = ''

  if (views.length > 0) {
    msg += 'VIEWS:\n'
    views.forEach((v) => {
      msg += `### ${v.id}\n`
      msg += `thesis: "${v.thesis}"\n`
      msg += `direction: ${v.direction}\n`
      msg += `conviction: ${v.conviction}\n`
      msg += `timeframe: ${v.timeframe}\n`
      msg += `affects:\n`
      msg += `  - ${v.affects_category}\n`
      msg += `  - keywords: [${v.affects_keywords.join(', ')}]\n`
      if (v.p_implied !== null) {
        msg += `p_implied: ${Math.round(v.p_implied * 100)}%\n`
      }
      if (v.notes) {
        msg += `notes: ${v.notes}\n`
      }
      msg += '\n'
    })
  }

  msg += `SESSION:\n`
  msg += `current_bankroll: $${session.current_bankroll.toLocaleString()}\n`
  msg += `starting_bankroll: $${session.starting_bankroll.toLocaleString()}\n`
  msg += `kelly_modifier: ${session.kelly_modifier}\n`
  msg += `recent_win_rate: ${session.recent_win_rate}\n`
  msg += `max_new_positions: ${session.max_new_positions}\n`

  if (session.avoid_categories.length > 0) {
    msg += `avoid_categories: [${session.avoid_categories.join(', ')}]\n`
  }

  if (session.positions.length > 0) {
    msg += `positions:\n`
    session.positions.forEach((p) => {
      msg += `  - ${p.market}: ${p.direction} @ $${p.avg_price.toFixed(2)} (${p.contracts} contracts, corr_group: ${p.corr_group})\n`
    })
  }

  if (Object.keys(session.corr_groups).length > 0) {
    msg += `corr_groups:\n`
    Object.entries(session.corr_groups).forEach(([group, data]) => {
      msg += `  ${group}: ${(data.pct_of_bankroll * 100).toFixed(1)}% of bankroll (cap remaining: ${(data.cap_remaining * 100).toFixed(1)}%)\n`
    })
  }

  msg += '\n'
  msg += `Analyze this market:\n`
  msg += `Title: "${market.title}"\n`
  msg += `YES @ $${market.yes_price.toFixed(2)} / NO @ $${market.no_price.toFixed(2)}\n`

  if (market.resolution_criteria) {
    msg += `Resolution criteria: ${market.resolution_criteria}\n`
  }
  if (market.resolution_date) {
    msg += `Expires: ${market.resolution_date}\n`
  }
  if (market.volume_24h !== undefined) {
    msg += `Volume (24h): $${market.volume_24h.toLocaleString()}\n`
  }
  if (market.category) {
    msg += `Category: ${market.category}\n`
  }
  if (market.corr_group) {
    msg += `Correlation group: ${market.corr_group}\n`
  }

  const signalBlock = formatSignals(signals)
  if (signalBlock) {
    msg += `\n${signalBlock}\n`
  }

  if (webContext) {
    const webBlock = formatWebContext(webContext)
    if (webBlock) {
      msg += `\n${webBlock}\n`
    }
  }

  return msg
}

export function buildPortfolioSystemPrompt(calibration?: CalibrationStats): string {
  let calibrationSection = ''
  if (calibration && calibration.resolved_predictions >= 3) {
    calibrationSection = `

## Track Record
- ${calibration.resolved_predictions} resolved · ${(calibration.overall_accuracy * 100).toFixed(0)}% accuracy · Brier ${calibration.brier_score.toFixed(3)}
- YES bias: ${calibration.yes_bias > 0.03 ? `+${(calibration.yes_bias*100).toFixed(0)}pp (over-predicting YES)` : calibration.yes_bias < -0.03 ? `${(calibration.yes_bias*100).toFixed(0)}pp (over-predicting NO)` : 'well calibrated'}
`
  }

  return `You are **Kalshi Edge** performing a **HOLISTIC PORTFOLIO ANALYSIS**. Your job is to analyze the entire trading portfolio as a unit — not market by market — and find risks, opportunities, and optimizations that only become visible at the portfolio level.${calibrationSection}

## Your Analysis Framework

### 1. Portfolio Health Score (0–100)
Score the overall portfolio on:
- **Diversification** (0–25): Spread across categories, no single bet > 20% of exposure
- **Edge Quality** (0–25): Are active positions high-confidence, well-reasoned bets?
- **Correlation Risk** (0–25): Exposure to correlated events that could all resolve bad simultaneously
- **Sizing Discipline** (0–25): Kelly compliance, no outsized positions

### 2. Correlation Cluster Analysis
Identify groups of positions that are likely to resolve in the same direction due to shared underlying drivers (e.g., all Fed-sensitive, all election-related, all crypto). For each cluster: name it, list positions, and quantify the concentration risk.

### 3. Position-by-Position Review
For each active position, give a brief Hold / Reduce / Exit recommendation with 1-sentence reasoning. Flag any positions where the original edge thesis may have changed.

### 4. New Opportunity Alignment
If available market opportunities are provided, identify which ones COMPLEMENT the existing portfolio (add diversification) vs which ones ADD concentrated risk. Prioritize opportunities that reduce portfolio correlation.

### 5. Action Plan
Provide a prioritized, numbered list of concrete actions. Be specific — "Reduce KXCPI-25APR-T3 to half size" not "reduce inflation exposure".

## Output Format
Use clear markdown headers. Be direct and specific. A portfolio analysis is only valuable if it drives action.`
}

export function buildPortfolioUserMessage(
  session: SessionState,
  opportunities: Array<{ ticker: string; title: string; direction: string; my_estimate_pct: number; market_price_pct: number; edge_pct: number; score: number; confidence: string }> = []
): string {
  let msg = `## Current Portfolio\n\n`
  msg += `Bankroll: $${session.current_bankroll.toLocaleString()} (started: $${session.starting_bankroll.toLocaleString()})\n`
  msg += `Recent win rate: ${session.recent_win_rate}\n`
  msg += `Kelly modifier: ${session.kelly_modifier}\n\n`

  if (session.positions.length === 0) {
    msg += `**No active positions.**\n\n`
  } else {
    msg += `### Active Positions (${session.positions.length})\n\n`
    session.positions.forEach((p, i) => {
      msg += `${i + 1}. **${p.market}** — BET ${p.direction} @ $${p.avg_price.toFixed(2)}\n`
      msg += `   Contracts: ${p.contracts} · Category: ${p.category} · Corr group: ${p.corr_group}\n`
    })
    msg += '\n'
  }

  if (Object.keys(session.corr_groups).length > 0) {
    msg += `### Correlation Group Exposures\n\n`
    Object.entries(session.corr_groups).forEach(([group, data]) => {
      msg += `- **${group}**: ${(data.pct_of_bankroll * 100).toFixed(1)}% of bankroll (cap remaining: ${(data.cap_remaining * 100).toFixed(1)}%)\n`
    })
    msg += '\n'
  }

  if (opportunities.length > 0) {
    msg += `## Available Market Opportunities (from last scan)\n\n`
    opportunities.forEach((opp, i) => {
      msg += `${i + 1}. **${opp.title}** [${opp.ticker}]\n`
      msg += `   Bet ${opp.direction} · My estimate ${opp.my_estimate_pct}% vs market ${opp.market_price_pct}% · Edge ${opp.edge_pct}% · Score ${opp.score} · ${opp.confidence} confidence\n`
    })
    msg += '\n'
  }

  msg += `Please provide a complete portfolio analysis following the framework in your instructions.`
  return msg
}

export function buildScannerUserMessage(
  markets: MarketInput[],
  views: MacroView[],
  session: SessionState,
  signalMap: Map<string, Signal[]> = new Map(),
  webContextMap: Map<string, WebContext> = new Map(),
): string {
  let msg = ''

  if (views.length > 0) {
    msg += 'VIEWS:\n'
    views.forEach((v) => {
      msg += `### ${v.id}\n`
      msg += `thesis: "${v.thesis}"\n`
      msg += `direction: ${v.direction}\n`
      msg += `conviction: ${v.conviction}\n`
      msg += `timeframe: ${v.timeframe}\n`
      msg += `affects:\n`
      msg += `  - ${v.affects_category}\n`
      msg += `  - keywords: [${v.affects_keywords.join(', ')}]\n`
      if (v.p_implied !== null) {
        msg += `p_implied: ${Math.round(v.p_implied * 100)}%\n`
      }
      msg += '\n'
    })
  }

  msg += `SESSION:\n`
  msg += `current_bankroll: $${session.current_bankroll.toLocaleString()}\n`
  msg += `kelly_modifier: ${session.kelly_modifier}\n`
  msg += `recent_win_rate: ${session.recent_win_rate}\n`

  if (session.positions.length > 0) {
    msg += `positions:\n`
    session.positions.forEach((p) => {
      msg += `  - ${p.market}: ${p.direction} @ $${p.avg_price.toFixed(2)} (corr_group: ${p.corr_group})\n`
    })
  }

  if (Object.keys(session.corr_groups).length > 0) {
    msg += `corr_groups:\n`
    Object.entries(session.corr_groups).forEach(([group, data]) => {
      msg += `  ${group}: ${(data.pct_of_bankroll * 100).toFixed(1)}% of bankroll\n`
    })
  }

  msg += '\n'
  msg += `Please scan the following ${markets.length} markets:\n\n`

  markets.forEach((m, i) => {
    msg += `${i + 1}. ${m.title}${m.id ? ` [${m.id}]` : ''}\n`
    msg += `   YES @ $${m.yes_price.toFixed(2)} / NO @ $${m.no_price.toFixed(2)}\n`
    if (m.resolution_criteria) {
      msg += `   Resolution: ${m.resolution_criteria}\n`
    }
    if (m.resolution_date) {
      msg += `   Expires: ${m.resolution_date}\n`
    }
    if (m.volume_24h !== undefined) {
      msg += `   Volume (24h): $${m.volume_24h.toLocaleString()}\n`
    }
    if (m.category) {
      msg += `   Category: ${m.category}\n`
    }
    const signals = signalMap.get(m.id ?? '')
    const signalBlock = formatSignals(signals ?? [])
    if (signalBlock) {
      msg += `   ${signalBlock.replace(/\n/g, '\n   ')}\n`
    }
    const webCtx = webContextMap.get(m.id ?? '')
    if (webCtx) {
      const webBlock = formatWebContext(webCtx)
      if (webBlock) {
        msg += `   ${webBlock.replace(/\n/g, '\n   ')}\n`
      }
    }
    msg += '\n'
  })

  return msg
}
