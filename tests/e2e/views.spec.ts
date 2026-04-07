import { test, expect } from '@playwright/test'

test.describe('Views Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/views', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ views: [] }),
        })
      } else {
        await route.continue()
      }
    })
    await page.goto('/views')
  })

  test('loads the views page with heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Macro Views' })).toBeVisible()
  })

  test('shows empty state when no views exist', async ({ page }) => {
    // Empty state: "No macro views yet" + Add Your First View button
    await expect(page.getByText('No macro views yet')).toBeVisible()
  })

  test('opens add view form', async ({ page }) => {
    // Click "Add Your First View" or the "Add View" button in header
    const addButton = page.getByRole('button', { name: /Add View|Add Your First View/i })
    await addButton.first().click()

    // Modal opens — "New Macro View" heading and Thesis textarea visible
    await expect(page.getByText('New Macro View')).toBeVisible()
    await expect(page.getByPlaceholder('Describe your macro view thesis...')).toBeVisible()
  })

  test('can create a new view', async ({ page }) => {
    const newView = {
      id: 'view-test-001',
      thesis: 'Fed will cut rates in Q4',
      direction: 'DOVISH',
      conviction: 'HIGH' as const,
      timeframe: 'through 2025-12-31',
      affects_category: 'Economics/Finance',
      affects_keywords: ['fed', 'rate'],
      p_implied: 0.7,
      notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await page.route('**/api/views', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ view: newView }),
        })
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ views: [newView] }),
        })
      } else {
        await route.continue()
      }
    })

    // Open modal
    const addButton = page.getByRole('button', { name: /Add View|Add Your First View/i })
    await addButton.first().click()

    // Fill in thesis
    await page.getByPlaceholder('Describe your macro view thesis...').fill('Fed will cut rates in Q4')

    // Fill in required direction field
    await page.getByPlaceholder(/hawkish-on-fed|bullish/i).fill('DOVISH')

    // Set a date for "Valid Through"
    await page.locator('input[type="date"]').first().fill('2025-12-31')

    // Submit with "Save View" button
    await page.getByRole('button', { name: 'Save View' }).click()

    // View thesis should appear in the list
    await expect(page.getByText('Fed will cut rates in Q4')).toBeVisible({ timeout: 5000 })
  })
})
