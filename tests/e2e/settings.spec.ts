import { test, expect } from '@playwright/test'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
  })

  test('loads the settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })

  test('shows API key fields', async ({ page }) => {
    await expect(page.getByLabel(/anthropic/i)).toBeVisible()
    await expect(page.getByLabel(/kalshi/i)).toBeVisible()
  })

  test('shows risk management fields', async ({ page }) => {
    await expect(page.getByLabel(/edge threshold/i)).toBeVisible()
    await expect(page.getByLabel(/position/i)).toBeVisible()
  })

  test('saves settings and shows confirmation', async ({ page }) => {
    // Intercept PUT to avoid real API calls
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            settings: {
              anthropic_api_key: 'sk-a••••••••key',
              kalshi_api_key: 'kx-t••••••••key',
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

    await page.getByRole('button', { name: /save/i }).click()

    // Should show success feedback
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5000 })
  })
})
