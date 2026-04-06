# Kalshi Edge — Session Context

## How to Use This File

Paste the contents of this file (or the relevant sections) into your chat as a `SESSION:` block before asking Kalshi Edge to analyze markets. The agent uses this to enforce correlation caps, calibrate position sizing to your actual bankroll, and avoid double-counting existing exposure.

Update this file before each trading session. The `positions` section and `corr_groups` should reflect your live Kalshi portfolio at session start.

---

## Bankroll

```
current_bankroll: $10,000          # your total Kalshi account balance today
starting_bankroll: $10,000         # original capital deposited (for drawdown tracking)
session_high_water_mark: $10,000   # highest balance in the last 30 days
```

---

## Open Positions

```
# Format per position:
#   market:         Kalshi market title
#   direction:      YES or NO
#   contracts:      number of contracts held
#   avg_price:      average entry price (in dollars, e.g. 0.28)
#   current_price:  current market price for your direction
#   notional:       contracts × avg_price (your total at-risk dollars)
#   category:       one of [Economics/Finance, Politics & Elections, Sports, Other/General]
#   corr_group:     tag for correlated positions (e.g. all Fed meeting markets = "fed-2026")
#                   use "none" if the position is uncorrelated

positions:
  - market: ""
    direction: 
    contracts: 0
    avg_price: 0.00
    current_price: 0.00
    notional: $0.00
    category: 
    corr_group: none

# Example (delete/replace with your actual positions):
# - market: "Will the Fed cut rates at the March 2026 FOMC meeting?"
#   direction: NO
#   contracts: 150
#   avg_price: 0.28
#   current_price: 0.31
#   notional: $42.00
#   category: Economics/Finance
#   corr_group: fed-2026
#
# - market: "Will the Fed cut rates at the May 2026 FOMC meeting?"
#   direction: NO
#   contracts: 100
#   avg_price: 0.30
#   current_price: 0.30
#   notional: $30.00
#   category: Economics/Finance
#   corr_group: fed-2026
```

---

## Correlation Group Exposure

```
# Summarize total exposure per corr_group.
# The agent enforces a 15% bankroll cap per group.
# Calculate: total_notional / current_bankroll × 100 = pct_of_bankroll
# cap_remaining = 15.0 − pct_of_bankroll

corr_groups:
  fed-2026:
    total_notional: $0.00
    pct_of_bankroll: 0.00%
    cap_remaining: 15.00%
  
  # Add additional groups as needed:
  # senate-2026:
  #   total_notional: $0.00
  #   pct_of_bankroll: 0.00%
  #   cap_remaining: 15.00%
```

---

## Recent Performance (Last 30 Days)

```
realized_pnl: $0           # net profit/loss on closed positions, last 30 days
open_pnl: $0               # unrealized gain/loss on current positions
win_rate: 0%               # % of closed trades that were profitable (last 20 trades minimum)
avg_win: $0                # average profit on winning trades
avg_loss: $0               # average loss on losing trades
total_trades_closed: 0     # number of closed trades in last 30 days
```

---

## Kelly Confidence Modifier

```
# The agent uses this modifier to scale all Kelly fractions.
# Recent win rate determines the appropriate modifier:
#
#   > 60% win rate  → 1.0  (standard sizing)
#   50–60% win rate → 1.0  (standard sizing)
#   < 50% win rate  → 0.75 (automatic reduction — agent will apply this regardless of stated value)
#
# You may set a lower value manually if you want to trade more conservatively this session.

recent_win_rate: 0%        # fill in from recent_performance above
kelly_modifier: 1.0        # agent will override to 0.75 if recent_win_rate < 50%
```

---

## Session Constraints

```
# The agent will respect these limits for the current session only.

max_new_positions: 5       # maximum new trades to recommend in this session (0 = unlimited)
avoid_categories:          # categories to skip entirely this session (leave empty to trade all)
  - []
  # Example: [Sports] to skip sports markets today
  # Example: [Politics & Elections, Sports] to focus on economics only

session_notes: ""
  # Any constraints or context for this session.
  # Example: "Earnings week — avoid GDP and jobs adjacent markets until Friday."
  # Example: "Only looking at Fed-related markets today."
```
