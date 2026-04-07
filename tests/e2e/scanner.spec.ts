import { test, expect } from '@playwright/test'

const mockScanResult = `## Market Scan Results — 2025-04-06
Markets screened: 3
Active views applied: none

### Ranked Opportunities

| Rank | Market | Dir | My Est. | Market | Edge | Score | Flags |
|------|--------|-----|---------|--------|------|-------|-------|
| 1 | Will the Fed cut rates? | YES | 65% | 45% | +20% | 95 | |
| 2 | Will inflation fall below 3%? | YES | 62% | 60% | +2% | 40 | [THIN] |
| 3 | Will Chiefs win Super Bowl? | NO | 75% | 30% | +5% | 55 | |

### Top 3 — Recommended for Full Analysis

**#1: Will the Fed cut rates?**
- Quick rationale: Strong economic signals support rate cut
- Suggested direction: YES
- Quick estimate: 65% vs. market's 45% = ~20% edge
`

const mockKalshiMarkets = [
  { ticker: 'FED-DEC', title: 'Will the Fed cut rates?', yes_ask: 45, yes_bid: 43, volume_24h: 5000 },
  { ticker: 'INFL', title: 'Will inflation fall below 3%?', yes_ask: 60, yes_bid: 58, volume_24h: 800 },
  { ticker: 'NFL-KC', title: 'Will Chiefs win Super Bowl?', yes_ask: 30, yes_bid: 28, volume_24h: 12000 },
]

test.describe('Scanner Page - Auto-Scan UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scanner')
  })

  test('loads the scanner page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Market Scanner' })).toBeVisible()
  })

  test('shows Auto-Scan Live Markets heading', async ({ page }) => {
    await expect(page.getByText('Auto-Scan Live Markets')).toBeVisible()
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

  test('manual entry section is present (collapsed by default)', async ({ page }) => {
    // The collapsible button contains "Manual Entry" text
    await expect(page.getByRole('button', { name: /manual entry/i })).toBeVisible()
  })

  test('performs auto-scan with loading states and shows results', async ({ page }) => {
    // Phase 1: mock the Kalshi markets fetch
    await page.route('**/api/kalshi/markets**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ markets: mockKalshiMarkets, cursor: null }),
      })
    })

    // Phase 2: mock the auto-scan endpoint
    await page.route('**/api/auto-scan', async (route) => {
      await new Promise((r) => setTimeout(r, 150))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: mockScanResult,
          markets_scanned: 3,
          markets: mockKalshiMarkets,
        }),
      })
    })

    await page.getByRole('button', { name: 'Scan Kalshi Now' }).click()

    // Phase 1 loading: button text changes to "Fetching markets..."
    await expect(page.getByRole('button', { name: /Fetching markets\.\.\./i })).toBeVisible({ timeout: 5000 })

    // Results eventually appear
    await expect(page.getByText(/Will the Fed cut rates|Market Scan Results|Ranked/i)).toBeVisible({ timeout: 30000 })
  })

  test('shows error message on scan failure', async ({ page }) => {
    await page.route('**/api/kalshi/markets**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Kalshi API key not configured. Please add it in Settings.' }),
      })
    })

    await page.getByRole('button', { name: 'Scan Kalshi Now' }).click()

    await expect(page.getByText(/API key|Settings|error/i)).toBeVisible({ timeout: 10000 })
  })

  test('category dropdown has expected options', async ({ page }) => {
    const categorySelect = page.getByRole('combobox').first()
    // Check it contains the expected options
    await expect(categorySelect.locator('option', { hasText: 'All' })).toBeAttached()
    await expect(categorySelect.locator('option', { hasText: 'Economics/Finance' })).toBeAttached()
    await expect(categorySelect.locator('option', { hasText: 'Sports' })).toBeAttached()
  })

  test('slider changes the displayed market count', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()

    // Default is 15 — label shows "Markets to scan: 15"
    await expect(page.locator('label').filter({ hasText: 'Markets to scan:' })).toContainText('15')

    // Move to 25
    await slider.fill('25')

    // Label should now show 25
    await expect(page.locator('label').filter({ hasText: 'Markets to scan:' })).toContainText('25')
  })
})
