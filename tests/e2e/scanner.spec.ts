import { test, expect } from '@playwright/test'

const mockOpportunities = [
  {
    ticker: 'FED-DEC',
    title: 'Will the Fed cut rates?',
    direction: 'YES' as const,
    my_estimate_pct: 65,
    market_price_pct: 45,
    edge_pct: 20,
    score: 95,
    rationale: 'Strong economic signals support a rate cut.',
    key_risk: 'Inflation surprise could delay action.',
    flags: [],
    confidence: 'HIGH' as const,
    yes_price: 0.45,
    no_price: 0.55,
    volume_24h: 5000,
    resolution_date: null,
  },
]

test.describe('Scanner Page - Auto-Scan UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scanner')
    await page.waitForSelector('h1', { timeout: 10000 })
  })

  test('loads the scanner page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Market Scanner' })).toBeVisible()
  })

  test('shows page subtitle', async ({ page }) => {
    await expect(page.getByText(/Fetch live Kalshi markets/i)).toBeVisible()
  })

  test('shows category filter dropdown', async ({ page }) => {
    const categorySelect = page.getByRole('combobox').first()
    await expect(categorySelect).toBeVisible()
  })

  test('shows Scan Kalshi Now button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Scan Kalshi Now' })).toBeVisible()
  })

  test('shows market count slider', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()
    await expect(slider).toBeVisible()
  })

  test('shows min volume filter buttons', async ({ page }) => {
    // Min. Volume section always visible with Any/$500+/$1K+/$5K+ buttons
    await expect(page.getByRole('button', { name: 'Any' })).toBeVisible()
    await expect(page.getByRole('button', { name: '$500+' })).toBeVisible()
  })

  test('performs auto-scan and shows opportunity cards', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/auto-scan',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            opportunities: mockOpportunities,
            screened_out: [],
            session_notes: '',
            markets_scanned: 3,
          }),
        })
      }
    )

    // Set up response waiter BEFORE the click
    const autoScanDone = page.waitForResponse(
      (resp) => resp.url().includes('/api/auto-scan'),
      { timeout: 15000 }
    )
    await page.getByRole('button', { name: 'Scan Kalshi Now' }).click()
    await autoScanDone

    // OpportunityCard renders the market title when opportunities exist
    await expect(page.getByText('Will the Fed cut rates?')).toBeVisible({ timeout: 10000 })
  })

  test('shows error message on scan failure', async ({ page }) => {
    // Scanner calls /api/auto-scan directly (Kalshi fetch happens server-side)
    await page.route(
      (url) => url.pathname === '/api/auto-scan',
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Kalshi API key not configured. Please add it in Settings.' }),
        })
      }
    )

    await page.getByRole('button', { name: 'Scan Kalshi Now' }).click()

    // Match the specific toast message (not the nav "Settings" link)
    await expect(page.getByText('Kalshi API key not configured. Please add it in Settings.')).toBeVisible({ timeout: 2000 })
  })

  test('category dropdown has expected options', async ({ page }) => {
    const categorySelect = page.getByRole('combobox').first()
    await expect(categorySelect.locator('option', { hasText: 'All' })).toBeAttached()
    await expect(categorySelect.locator('option', { hasText: 'Economics/Finance' })).toBeAttached()
    await expect(categorySelect.locator('option', { hasText: 'Sports' })).toBeAttached()
  })

  test('slider changes the displayed market count', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()

    // Default is 15
    await expect(page.locator('label').filter({ hasText: 'Markets to scan:' })).toContainText('15')

    // Move slider to 25
    await slider.fill('25')

    // Label should update to show 25
    await expect(page.locator('label').filter({ hasText: 'Markets to scan:' })).toContainText('25')
  })
})
