import { test, expect } from '@playwright/test'

test.describe('Analyze Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze')
  })

  test('loads the analyze page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Market Analyzer' })).toBeVisible()
  })

  test('shows market input form fields', async ({ page }) => {
    // Labels don't have htmlFor — use placeholder text
    await expect(page.getByPlaceholder(/Will the Fed cut rates/i)).toBeVisible()
    // YES Price field — two inputs with placeholder "0.00", first is YES
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
- **Edge**: +20% on YES

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

    // Fill in market title
    await page.getByPlaceholder(/Will the Fed cut rates/i).fill('Will the Fed cut rates in December?')

    // Fill in YES price (first 0.00 input)
    await page.locator('input[placeholder="0.00"]').first().fill('0.45')

    // Click analyze
    await page.getByRole('button', { name: 'Analyze Market' }).click()

    // Button becomes "Analyzing..." during load
    await expect(page.getByRole('button', { name: 'Analyzing...' })).toBeVisible({ timeout: 3000 })

    // Results appear
    await expect(page.getByText(/Trade Recommendation/i)).toBeVisible({ timeout: 15000 })
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

    // Toast or error shows the message
    await expect(page.getByText(/API key|Settings/i)).toBeVisible({ timeout: 10000 })
  })
})
