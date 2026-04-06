import { test, expect } from '@playwright/test'

test.describe('Analyze Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze')
  })

  test('loads the analyze page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /analyze/i })).toBeVisible()
  })

  test('shows market input form fields', async ({ page }) => {
    await expect(page.getByLabel(/market title/i)).toBeVisible()
    await expect(page.getByLabel(/yes price/i)).toBeVisible()
  })

  test('shows analyze button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /analyze/i })).toBeVisible()
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

    // Mock the analyze API
    await page.route('**/api/analyze', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: mockResult }),
      })
    })

    // Fill in the form
    await page.getByLabel(/market title/i).fill('Will the Fed cut rates in December?')
    await page.getByLabel(/yes price/i).fill('0.45')

    // Submit
    await page.getByRole('button', { name: /analyze/i }).click()

    // Should show loading state
    await expect(page.getByText(/analyzing|loading/i)).toBeVisible({ timeout: 3000 })

    // Should show results
    await expect(page.getByText(/Trade Recommendation|Edge|YES/i)).toBeVisible({ timeout: 15000 })
  })

  test('shows error when API key is not configured', async ({ page }) => {
    await page.route('**/api/analyze', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Anthropic API key not configured. Please add it in Settings.' }),
      })
    })

    await page.getByLabel(/market title/i).fill('Test market')
    await page.getByLabel(/yes price/i).fill('0.5')
    await page.getByRole('button', { name: /analyze/i }).click()

    await expect(page.getByText(/API key|Settings/i)).toBeVisible({ timeout: 10000 })
  })
})
