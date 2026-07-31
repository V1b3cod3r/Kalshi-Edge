import { test, expect } from '@playwright/test'

// UAT for the "Realized Return by Strategy" table added to the Predictions
// page (docs/STRATEGY_EXPANSION_PLAN.md). Mocks /api/predictions and
// /api/calibration at the network level — same convention as
// settings.spec.ts — so this never depends on or mutates real dev-server
// data.

const emptyStats = {
  total_predictions: 0,
  resolved_predictions: 0,
  overall_accuracy: 0,
  brier_score: 0.25,
  claude_brier: 0.25,
  market_brier: null,
  claude_vs_market: 'Insufficient data',
  yes_bias: 0,
  recent_accuracy: 0,
  recent_win_rate: null,
  by_source: {
    scanner: { count: 0, brier: null, win_rate: null },
    analyze: { count: 0, brier: null, win_rate: null },
  },
  by_category: {},
  by_edge_bucket: [],
  market_brier_midpoint_samples: 0,
  by_strategy: [],
}

const seededStats = {
  ...emptyStats,
  total_predictions: 3,
  resolved_predictions: 1,
  by_edge_bucket: [
    { bucket: '0-2%', count: 0, resolved: 0, claimed_edge_avg: 0, realized_roi_pct: null, hit_rate: null },
    { bucket: '2-4%', count: 0, resolved: 0, claimed_edge_avg: 0, realized_roi_pct: null, hit_rate: null },
    { bucket: '4-6%', count: 0, resolved: 0, claimed_edge_avg: 0, realized_roi_pct: null, hit_rate: null },
    { bucket: '6-10%', count: 0, resolved: 0, claimed_edge_avg: 0, realized_roi_pct: null, hit_rate: null },
    { bucket: '10%+', count: 3, resolved: 1, claimed_edge_avg: 14.2, realized_roi_pct: 25, hit_rate: 1 },
  ],
  by_strategy: [
    { strategy: 'dated-favorites', count: 1, resolved: 0, hit_rate: null, realized_roi_pct: null, brier: null },
    { strategy: 'llm-divergence', count: 1, resolved: 1, hit_rate: 1, realized_roi_pct: 25, brier: 0.01 },
    { strategy: 'settlement-snipe', count: 1, resolved: 0, hit_rate: null, realized_roi_pct: null, brier: null },
  ],
}

const seededPredictions = [
  {
    id: 'p1', market_title: 'LLM pick', ticker: 'LLM-1', category: 'Economics/Finance',
    predicted_probability: 0.9, direction: 'YES', market_price: 0.8, edge_pct: 14.2,
    created_at: new Date().toISOString(), source: 'autopilot', strategy: 'llm-divergence',
    actionable: true, execution_price: 0.8, outcome: 'YES', resolved_at: new Date().toISOString(),
  },
  {
    id: 'p2', market_title: 'Dated favorite pick', ticker: 'FAV-1', category: 'Politics',
    predicted_probability: 0.93, direction: 'YES', market_price: 0.9, edge_pct: 2.0,
    created_at: new Date().toISOString(), source: 'autopilot', strategy: 'dated-favorites',
    actionable: true, execution_price: 0.9,
  },
  {
    id: 'p3', market_title: 'Settlement snipe pick', ticker: 'KXTEMPNYCH-1-T74.99', category: 'Other/General',
    predicted_probability: 0.9, direction: 'YES', market_price: 0.2, edge_pct: 68,
    created_at: new Date().toISOString(), source: 'autopilot', strategy: 'settlement-snipe',
    actionable: true, execution_price: 0.2,
  },
]

test.describe('Predictions page — realized ROI by strategy', () => {
  test('with zero predictions, both ROI tables stay hidden (not an empty/broken table)', async ({ page }) => {
    await page.route('**/api/predictions', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictions: [] }) })
    })
    await page.route('**/api/calibration', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stats: emptyStats }) })
    })

    await page.goto('/predictions')
    await expect(page.getByRole('heading', { name: 'Calibration Tracker' })).toBeVisible()

    await expect(page.getByText('Realized Return by Strategy')).not.toBeVisible()
    await expect(page.getByText('Realized Return by Claimed Edge')).not.toBeVisible()
  })

  test('with logged predictions across strategies, the By Strategy table renders correct rows', async ({ page }) => {
    await page.route('**/api/predictions', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictions: seededPredictions }) })
    })
    await page.route('**/api/calibration', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stats: seededStats }) })
    })

    await page.goto('/predictions')
    await expect(page.getByText('Realized Return by Strategy')).toBeVisible()

    const table = page.locator('div', { hasText: 'Realized Return by Strategy' }).locator('table')
    await expect(table.locator('text=dated-favorites')).toBeVisible()
    await expect(table.locator('text=llm-divergence')).toBeVisible()
    await expect(table.locator('text=settlement-snipe')).toBeVisible()

    // llm-divergence resolved with +25% ROI — should render green and signed.
    const llmRow = table.locator('tr', { hasText: 'llm-divergence' })
    await expect(llmRow.locator('text=+25%')).toBeVisible()

    // dated-favorites and settlement-snipe are logged but unresolved — ROI
    // column must show the em-dash placeholder, not null/undefined/NaN.
    const favRow = table.locator('tr', { hasText: 'dated-favorites' })
    await expect(favRow.locator('td').nth(5)).toHaveText('—')
  })
})
