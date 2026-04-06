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

test.describe('Scanner Page - Auto-Scan UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scanner')
  })

  test('loads the scanner page', async ({ page }) => {
    await expect(page).toHaveTitle(/Kalshi Edge|Scanner/i)
  })

  test('shows Auto-Scan Live Markets heading', async ({ page }) => {
    await expect(page.getByText(/Auto-Scan Live Markets/i)).toBeVisible()
  })

  test('shows category filter dropdown', async ({ page }) => {
    const categorySelect = page.getByRole('combobox').first()
    await expect(categorySelect).toBeVisible()
  })

  test('shows Scan Kalshi Now button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Scan Kalshi Now/i })).toBeVisible()
  })

  test('shows market count slider or input', async ({ page }) => {
    // Slider or number input for market count
    const slider = page.locator('input[type="range"]')
    await expect(slider).toBeVisible()
  })

  test('manual entry section is present (collapsed or at bottom)', async ({ page }) => {
    // Manual entry should be demoted — look for its trigger or section
    const manualSection = page.getByText(/manual|paste|enter markets/i)
    await expect(manualSection).toBeVisible()
  })

  test('performs auto-scan with loading states and shows results', async ({ page }) => {
    // Mock the auto-scan endpoint
    await page.route('**/api/auto-scan', async (route) => {
      // Add a small delay to allow loading state to be visible
      await new Promise((r) => setTimeout(r, 100))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: mockScanResult,
          markets_scanned: 3,
          markets: [
            { title: 'Will the Fed cut rates?', yes_price: 0.45, no_price: 0.55, volume_24h: 5000 },
            { title: 'Will inflation fall below 3%?', yes_price: 0.6, no_price: 0.4, volume_24h: 800 },
            { title: 'Will Chiefs win Super Bowl?', yes_price: 0.3, no_price: 0.7, volume_24h: 12000 },
          ],
        }),
      })
    })

    await page.getByRole('button', { name: /Scan Kalshi Now/i }).click()

    // Should show some loading indicator
    await expect(page.getByText(/fetching|loading|scanning/i)).toBeVisible({ timeout: 5000 })

    // Should eventually show results
    await expect(page.getByText(/Fed cut rates|Market Scan Results|Ranked/i)).toBeVisible({ timeout: 15000 })
  })

  test('shows error message on scan failure', async ({ page }) => {
    await page.route('**/api/auto-scan', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Kalshi API key not configured. Please add it in Settings.' }),
      })
    })

    await page.getByRole('button', { name: /Scan Kalshi Now/i }).click()

    await expect(page.getByText(/API key|Settings|error/i)).toBeVisible({ timeout: 10000 })
  })

  test('category dropdown has expected options', async ({ page }) => {
    const categorySelect = page.getByRole('combobox').first()
    await categorySelect.click()

    // Should have "All" option and category-specific options
    const options = page.getByRole('option')
    const count = await options.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('slider changes the displayed market count', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first()
    const initialValue = await slider.inputValue()

    // Move slider to max
    await slider.fill('25')

    // Label should update
    await expect(page.getByText(/25/)).toBeVisible()
    expect(await slider.inputValue()).toBe('25')
  })
})
