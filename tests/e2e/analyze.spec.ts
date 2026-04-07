import { test, expect } from '@playwright/test'

test.describe('Analyze Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock session so the page doesn't depend on real server state
    await page.route('**/api/session', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ session: { current_bankroll: 10000 } }),
        })
      } else {
        await route.continue()
      }
    })
    await page.goto('/analyze')
    // Wait for page content to be present
    await page.waitForSelector('h1', { timeout: 10000 })
  })

  test('loads the analyze page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Market Analyzer' })).toBeVisible()
  })

  test('shows market input form fields', async ({ page }) => {
    await expect(page.getByPlaceholder(/Will the Fed cut rates/i)).toBeVisible()
    await expect(page.locator('input[placeholder="0.00"]').first()).toBeVisible()
  })

  test('shows analyze button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Analyze Market' })).toBeVisible()
  })

  test('submits market and displays analysis result', async ({ page }) => {
    const mockResult = `## Will the Fed cut rates in December?
**Contract**: Fed lowers rate by ≥25bps at December FOMC
**Expires**: 2025-12-15

### Probability Estimate
- My estimate (data only): 65% YES
- View-adjusted estimate: 65% YES
- Implied by market: 45% YES
- **Edge**: +20% on YES

### Macro View Influence
- Views applied: None

### Trade Recommendation
- **Direction**: YES
- **Recommended size**: 2% of bankroll`

    await page.route('**/api/analyze', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: mockResult }),
      })
    })

    await page.getByPlaceholder(/Will the Fed cut rates/i).fill('Will the Fed cut rates in December?')
    await page.locator('input[placeholder="0.00"]').first().fill('0.45')

    // Wait for button to be enabled then click
    await page.getByRole('button', { name: 'Analyze Market' }).click()

    // The AnalysisResult component renders a "Trade Recommendation" h3 heading
    await expect(page.getByText('Trade Recommendation')).toBeVisible({ timeout: 15000 })
  })

  test('shows error when API key is not configured', async ({ page }) => {
    await page.route('**/api/analyze', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Anthropic API key not configured. Please add it in Settings.' }),
      })
    })

    await page.getByPlaceholder(/Will the Fed cut rates/i).fill('Test market')
    await page.locator('input[placeholder="0.00"]').first().fill('0.5')
    await page.getByRole('button', { name: 'Analyze Market' }).click()

    // Toast auto-dismisses after 3s — check immediately (within 2s)
    await expect(page.getByText(/Anthropic API key not configured/i)).toBeVisible({ timeout: 2000 })
  })
})
