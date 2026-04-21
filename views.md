# Kalshi Edge — Macro Views

Last updated: [DATE]

## How to Use This File

Paste the contents of this file (or the relevant view blocks) into your chat as a `VIEWS:` block before asking Kalshi Edge to analyze markets. The agent will blend your views into its probability estimates according to the Macro View Integration Protocol.

**Rules:**
- Each view has a unique ID (`view-XX`) that the agent references in its output
- `conviction` must be exactly `LOW`, `MEDIUM`, or `HIGH`
- `timeframe` must be in `through YYYY-MM-DD` format — views are ignored for markets that resolve after this date
- `affects.keywords` should match words likely to appear in Kalshi market titles and resolution criteria
- `p_implied` is optional but recommended — it quantifies your view as a YES probability for markets in the relevant category. Without it, the agent will infer direction from your thesis.
- Delete or comment out (#) views you no longer hold
- Add a note to `view_interactions` when two views conflict or strongly reinforce each other

---

## View Blocks

### view-01
```
thesis: "I believe inflation (CPI/PCE) will remain sticky above 3% through end of 2026"
direction: hawkish-on-fed
conviction: HIGH
timeframe: through 2026-12-31
affects:
  category: Economics/Finance
  keywords: [fed, rate cut, inflation, CPI, PCE, FOMC, interest rate, basis points, bps, monetary policy, cut, hike, pause]
p_implied: 75%   # probability that Fed stays on hold (does NOT cut) at any given meeting through year-end
notes: "Tariff pass-through and services inflation keeping CPI elevated. Shelter still sticky."
```

---

### view-02
```
thesis: "I believe tariffs will persist and contribute to a mild recession by Q4 2026"
direction: bearish-on-growth
conviction: MEDIUM
timeframe: through 2026-12-31
affects:
  category: Economics/Finance
  keywords: [GDP, recession, unemployment, jobs, payrolls, NFP, growth, tariffs, trade, manufacturing, PMI, ISM, consumer]
p_implied: 55%   # probability of at least one quarter of negative GDP growth in 2026
notes: "Manufacturing PMI already contracting; consumer confidence declining. Tariff uncertainty depressing capex."
```

---

### view-03
```
thesis: "Republicans hold the Senate majority through 2027"
direction: bullish-on-republican-control
conviction: HIGH
timeframe: through 2027-01-20
affects:
  category: Politics & Elections
  keywords: [senate, republican, GOP, majority, legislation, confirmation, filibuster, budget, reconciliation, vote]
p_implied: 85%   # probability Republicans retain Senate majority
notes: ""
```

---

### view-04
```
thesis: "The Fed cuts rates no more than once in all of 2026"
direction: hawkish-on-fed
conviction: MEDIUM
timeframe: through 2026-12-31
affects:
  category: Economics/Finance
  keywords: [fed, rate cut, FOMC, interest rate, monetary policy, basis points, 25bp, cuts, easing, pivot]
p_implied: 70%   # probability of ≤1 total cut in 2026
notes: "Overlaps with view-01. Both reinforce hawkish Fed stance. view-02 creates a potential conflict in H2 2026 — recession could force cuts even with sticky inflation."
```

---

### view-05
```
thesis: "The Trump administration maintains high tariff rates (average effective tariff above 15%) through mid-2027"
direction: bullish-on-tariffs
conviction: HIGH
timeframe: through 2027-06-30
affects:
  category: Politics & Elections
  keywords: [tariff, trade, import, China, trade war, trade deal, customs, duty, executive order]
p_implied: 80%   # probability that no major tariff rollback occurs (average effective rate stays >15%)
notes: "Tariff policy viewed as structural, not negotiating tactic. WTO disputes pending but not expected to force reduction."
```

---

### view-06
```
thesis: ""
direction: 
conviction: 
timeframe: through 
affects:
  category: 
  keywords: []
p_implied:   # optional
notes: ""
```
# ^ Template for new views — copy, fill in, and rename the ID

---

## View Interaction Notes

**Reinforcing pairs:**
- view-01 + view-04: Both are hawkish on Fed. Together they push NO-cut probability higher. When both apply to a Fed meeting market, their combined effect will be larger — check that the 15pp cap is not breached.
- view-03 + view-05: Both assume continued Republican policy dominance. Reinforcing on tariff-related and legislative markets.

**Conflicting pairs:**
- view-02 vs. view-04: A severe enough recession (view-02) could force Fed cuts even with sticky inflation — contradicting view-04's "≤1 cut" thesis. If both apply to a late-2026 Fed meeting market, the agent will average the implied probabilities and flag the conflict. User should decide which view dominates after Q3 GDP data.

**Expiration watch:**
- view-03 expires 2027-01-20. Update after any major Senate vote or special election that shifts the majority math.
- view-05 expires 2027-06-30. Update if a major trade deal is announced.
