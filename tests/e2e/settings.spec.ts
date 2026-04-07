import { test, expect } from '@playwright/test'

const mockSettings = {
  anthropic_api_key: 'sk-a••••••••1234',
  kalshi_api_key: '',
  min_edge_threshold: 0.03,
  max_position_pct: 0.05,
  max_corr_exposure_pct: 0.15,
  default_kelly_fraction: 'medium',
}

const mockSession = {
  current_bankroll: 10000,
  starting_bankroll: 10000,
  positions: [],
  corr_groups: {},
  recent_win_rate: 0.58,
  kelly_modifier: 1.0,
  avoid_categories: [],
  max_new_positions: 5,
}

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock settings GET so the form loads without depending on the real dev server state
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: mockSettings }) })
      } else {
        await route.continue()
      }
    })
    // Mock session GET — settings page fetches BOTH on mount
    await page.route('**/api/session', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: mockSession }) })
      } else {
        await route.continue()
      }
    })
    await page.goto('/settings')
    // Wait for the form to be rendered (loading=false)
    await page.waitForSelector('button:has-text("Save API Keys & Settings")', { timeout: 10000 })
  })

  test('loads the settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('shows API key fields', async ({ page }) => {
    await expect(page.getByText('Anthropic API Key')).toBeVisible()
    await expect(page.getByText('Kalshi API Key')).toBeVisible()
  })

  test('shows risk management fields', async ({ page }) => {
    await expect(page.getByText('Min Edge Threshold')).toBeVisible()
    await expect(page.getByText('Max Position Size')).toBeVisible()
  })

  test('saves settings and shows confirmation', async ({ page }) => {
    // Mock the PUT — stacks on top of the beforeEach GET handler
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ settings: { ...mockSettings, min_edge_threshold: 0.04 } }),
        })
      } else {
        await route.continue()
      }
    })

    await page.getByRole('button', { name: 'Save API Keys & Settings' }).click()

    // Toast shows "Settings saved" and auto-dismisses after 3s — check immediately
    await expect(page.getByText(/Settings saved/i)).toBeVisible({ timeout: 3000 })
  })
})
