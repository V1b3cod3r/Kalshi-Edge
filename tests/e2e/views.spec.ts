import { test, expect } from '@playwright/test'

test.describe('Views Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock GET /api/views to return empty initially
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
    await expect(page.getByRole('heading', { name: /macro views/i })).toBeVisible()
  })

  test('shows empty state when no views exist', async ({ page }) => {
    // No views loaded; should see add/create button or empty message
    const addButton = page.getByRole('button', { name: /add view|new view|create/i })
    await expect(addButton).toBeVisible()
  })

  test('opens add view form', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add view|new view|create/i })
    await addButton.click()

    // Form fields should appear
    await expect(page.getByLabel(/thesis/i)).toBeVisible()
  })

  test('can create a new view', async ({ page }) => {
    const newView = {
      id: 'view-test-001',
      thesis: 'Fed will cut rates in Q4',
      direction: 'DOVISH',
      conviction: 'HIGH',
      timeframe: 'through 2025-12-31',
      affects_category: 'Economics/Finance',
      affects_keywords: ['fed', 'rate'],
      p_implied: 0.7,
      notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Mock POST to create the view
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

    const addButton = page.getByRole('button', { name: /add view|new view|create/i })
    await addButton.click()

    // Fill in the thesis field
    await page.getByLabel(/thesis/i).fill('Fed will cut rates in Q4')

    // Submit
    const submitButton = page.getByRole('button', { name: /save|submit|create/i })
    await submitButton.click()

    // View should appear in the list
    await expect(page.getByText('Fed will cut rates in Q4')).toBeVisible({ timeout: 5000 })
  })
})
