import { test, expect } from '@playwright/test'

// UAT for the strategy-registry additions to the Autopilot page.
//
// The first three tests hit the REAL dev server unmocked — safe, because
// toggling a switch only changes React state until "Save Guardrails" is
// clicked, so nothing is ever persisted or triggered.
//
// The save/reload test (4) DOES persist to whatever data directory the dev
// server under test is using, so it restores the original settings in a
// `finally` block — this suite may run against a shared/real dev
// environment, not just an isolated one, and must never leave a
// developer's real autopilot config mutated.
//
// The manual-run test (5) mocks the network instead of hitting
// /api/autopilot/run for real — this project's own guardrails are strict
// about not letting automated test runs trigger a real autopilot cycle,
// which could reach real Kalshi credentials if the dev server under test
// happens to have them configured.

test.describe('Autopilot page — strategy registry UI', () => {
  test('renders the strategy registry section with all three strategies', async ({ page }) => {
    await page.goto('/autopilot')
    await expect(page.getByRole('heading', { name: 'Autopilot' })).toBeVisible()

    await expect(page.getByText('LLM divergence')).toBeVisible()
    await expect(page.getByText('Dated favorites (opt-in, new)')).toBeVisible()
    await expect(page.getByText('Settlement sniping (opt-in, new)')).toBeVisible()
    await expect(page.getByText('Maker orders (opt-in)')).toBeVisible()
  })

  test('toggling Dated Favorites reveals its band/window sub-fields', async ({ page }) => {
    await page.goto('/autopilot')
    await page.waitForSelector('text=Dated favorites (opt-in, new)')

    // Sub-fields hidden until the strategy is enabled.
    await expect(page.getByText('Favorite band min ¢')).not.toBeVisible()

    const row = page.locator('div.flex.items-center.justify-between', { hasText: 'Dated favorites (opt-in, new)' })
    await row.locator('button').click()

    await expect(page.getByText('Favorite band min ¢')).toBeVisible()
    await expect(page.getByText('Favorite band max ¢')).toBeVisible()
    await expect(page.getByText('Min days out')).toBeVisible()
    await expect(page.getByText('Max days out')).toBeVisible()
  })

  test('toggling Settlement Sniping reveals its margin/confidence sub-fields', async ({ page }) => {
    await page.goto('/autopilot')
    await page.waitForSelector('text=Settlement sniping (opt-in, new)')

    await expect(page.getByText('Safety margin °F')).not.toBeVisible()

    const row = page.locator('div.flex.items-center.justify-between', { hasText: 'Settlement sniping (opt-in, new)' })
    await row.locator('button').click()

    await expect(page.getByText('Safety margin °F')).toBeVisible()
    await expect(page.getByText('Max confidence %')).toBeVisible()
  })

  test('strategy toggles and guardrail values persist across a real save + reload', async ({ page }) => {
    // Snapshot the real autopilot settings before touching anything, so they
    // can be restored afterward regardless of how the test finishes.
    const before = await (await page.request.get('/api/autopilot/status')).json()
    const originalAutopilot = before.autopilot

    try {
      await page.goto('/autopilot')
      await page.waitForSelector('text=Dated favorites (opt-in, new)')

      // Enable both new strategies.
      const datedRow = page.locator('div.flex.items-center.justify-between', { hasText: 'Dated favorites (opt-in, new)' })
      await datedRow.locator('button').click()
      const snipeRow = page.locator('div.flex.items-center.justify-between', { hasText: 'Settlement sniping (opt-in, new)' })
      await snipeRow.locator('button').click()

      // Change a couple of the newly-revealed numeric fields to distinctive values.
      const minPriceInput = page.locator('label:has-text("Favorite band min ¢")').locator('xpath=following-sibling::input[1]')
      await minPriceInput.fill('72')
      const marginInput = page.locator('label:has-text("Safety margin °F")').locator('xpath=following-sibling::input[1]')
      await marginInput.fill('3.5')

      await page.getByRole('button', { name: 'Save Guardrails' }).click()
      await expect(page.getByText(/Guardrails saved/i)).toBeVisible({ timeout: 5000 })

      // Real reload against the real server — proves actual persistence, not
      // just React state retention.
      await page.reload()
      await page.waitForSelector('text=Dated favorites (opt-in, new)')

      // Both strategies should still show their sub-fields (toggle persisted true).
      await expect(page.getByText('Favorite band min ¢')).toBeVisible()
      await expect(page.getByText('Safety margin °F')).toBeVisible()

      const minPriceAfterReload = page.locator('label:has-text("Favorite band min ¢")').locator('xpath=following-sibling::input[1]')
      await expect(minPriceAfterReload).toHaveValue('72')
      const marginAfterReload = page.locator('label:has-text("Safety margin °F")').locator('xpath=following-sibling::input[1]')
      await expect(marginAfterReload).toHaveValue('3.5')
    } finally {
      // Restore whatever was there before this test ran, via the API
      // directly — never leave a developer's real autopilot config mutated.
      await page.request.put('/api/settings', { data: { autopilot: originalAutopilot } })
    }
  })

  test('a manual run failure surfaces via toast, never a page crash (mocked — never triggers a real cycle)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))

    // Mocked rather than hitting /api/autopilot/run for real: this project's
    // own guardrails are strict about not letting an automated test run
    // trigger a real autopilot cycle, which could reach real Kalshi
    // credentials if the dev server under test happens to have them
    // configured. The SIT suite (tests/integration/autopilot-cycle.test.ts)
    // already exercises the real failure path end-to-end against an
    // isolated test server; this test verifies the UI's handling of it.
    // Full AutopilotSettings shape — the real /api/autopilot/status route
    // always returns a complete object (getSettings() deep-merges with
    // DEFAULT_AUTOPILOT), and the page relies on that: e.g.
    // form.category_blacklist.join(', ') is unguarded because it's never
    // actually undefined in production. A partial mock crashes the page on
    // that exact line — which is a test-fixture gap, not a component bug.
    const fullAutopilotSettings = {
      enabled: true, dry_run: true, min_effective_edge_pct: 15, min_confidence: 'HIGH',
      max_per_trade_usd: 25, max_daily_spend_usd: 100, max_daily_loss_usd: 50,
      max_open_positions: 10, max_exposure_usd: 250, kelly_fraction: 0.25,
      category_blacklist: ['Sports'], max_per_cluster_usd: 50, scan_limit: 40,
      exit_enabled: false, take_profit_pct: 40, max_days_to_resolution: 45,
      min_resolved_predictions_for_live: 30, require_calibration_to_go_live: false,
      kelly_haircut_high_pp: 3, kelly_haircut_medium_pp: 5, kelly_haircut_low_pp: 8,
      use_maker_orders: false,
      strategy_llm_divergence_enabled: true, strategy_dated_favorites_enabled: false,
      dated_favorites_min_price_cents: 65, dated_favorites_max_price_cents: 90,
      dated_favorites_min_days: 14, dated_favorites_max_days: 56,
      strategy_settlement_snipe_enabled: false, settlement_snipe_margin_f: 2,
      settlement_snipe_max_confidence_pct: 95,
    }
    await page.route('**/api/autopilot/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          autopilot: fullAutopilotSettings,
          last_run: null,
          today_spend_usd: 0,
          today_realized_pnl_usd: null,
          calibration: { total_predictions: 0, resolved_predictions: 0, overall_accuracy: 0, brier_score: 0.25, claude_brier: 0.25, market_brier: null, claude_vs_market: 'Insufficient data', yes_bias: 0, recent_accuracy: 0, recent_win_rate: null, by_source: { scanner: { count: 0, brier: null, win_rate: null }, analyze: { count: 0, brier: null, win_rate: null } }, by_category: {}, by_edge_bucket: [], market_brier_midpoint_samples: 0, by_strategy: [] },
        }),
      })
    })
    await page.route('**/api/autopilot/log*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) })
    })
    await page.route('**/api/autopilot/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: {
            id: 'run-uat-1', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
            status: 'error', error: 'Kalshi API Key ID and Private Key are both required for autopilot. Configure them in Settings.',
            dry_run: true, markets_scanned: 0, opportunities_considered: 0, trades: [],
          },
        }),
      })
    })

    await page.goto('/autopilot')
    await page.waitForSelector('text=LLM divergence')

    await page.getByRole('button', { name: /run cycle now/i }).click()

    await expect(page.getByText(/Cycle error:.*Kalshi API Key/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Autopilot' })).toBeVisible()
    expect(errors).toEqual([])
  })
})
