import { test, expect } from '@playwright/test'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
  })

  test('loads the settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('shows API key fields', async ({ page }) => {
    // Labels use inline style without htmlFor — check by text
    await expect(page.getByText('Anthropic API Key')).toBeVisible()
    await expect(page.getByText('Kalshi API Key')).toBeVisible()
  })

  test('shows risk management fields', async ({ page }) => {
    await expect(page.getByText('Min Edge Threshold')).toBeVisible()
    await expect(page.getByText('Max Position Size')).toBeVisible()
  })

  test('saves settings and shows confirmation', async ({ page }) => {
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            settings: {
              anthropic_api_key: 'sk-a••••••••1234',
              kalshi_api_key: 'kx-t••••••••abcd',
              min_edge_threshold: 0.03,
              max_position_pct: 0.05,
              max_corr_exposure_pct: 0.15,
              default_kelly_fraction: 'medium',
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.getByRole('button', { name: 'Save API Keys & Settings' }).click()

    // Success indicator: "✓ Key saved: ..." toast or inline message
    await expect(page.getByText(/✓ Key saved|saved/i)).toBeVisible({ timeout: 5000 })
  })
})
