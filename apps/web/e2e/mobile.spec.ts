import { expect, test, type Page } from '@playwright/test'

const apiOrigin = 'http://localhost:8000'
const cors = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json',
}

async function json(page: Page, path: string, status: number, body: unknown) {
  await page.route(`${apiOrigin}${path}`, (route) => route.fulfill({ status, headers: cors, body: JSON.stringify(body) }))
}

test('demo: a responder can run an incident from update to postmortem on a phone', async ({ page }) => {
  await page.goto('/demo')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  await page.getByRole('link', { name: 'Open the SEV1 incident' }).click()
  await expect(page.getByRole('heading', { name: 'Card authorizations failing for EU issuers' })).toBeVisible()

  await page.getByLabel('Post an update').fill('Rollback finished, auth success at 99.6%.')
  await page.getByRole('button', { name: 'Post update' }).click()
  await expect(page.getByText('Rollback finished, auth success at 99.6%.')).toBeVisible()

  await page.getByRole('button', { name: /Roll back deploy 4512.*Activate to advance/ }).click()
  await expect(page.getByText('2 of 3 done')).toBeVisible()

  await page.getByRole('button', { name: 'Fix deployed – start monitoring' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fix deployed – start monitoring' }).click()
  await page.getByRole('button', { name: 'Resolve incident' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Resolve incident' }).click()
  await expect(page.getByText('Incident resolved')).toBeVisible()

  await page.getByRole('button', { name: 'Draft from timeline' }).click()
  await expect(page.getByText('Pending engineering review', { exact: false })).toBeVisible()

  // Resolving the only open incident on Payments API restores it.
  await page.getByRole('link', { name: 'Services' }).first().click()
  const payments = page.getByRole('row', { name: /Payments API/ })
  await expect(payments.getByRole('combobox')).toHaveValue('operational')

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
})

test('demo: a simulated alert opens an incident and appears on the status page', async ({ page }) => {
  await page.goto('/demo#/services')
  await page.getByRole('button', { name: 'Simulate alert' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Service').selectOption({ label: 'Identity' })
  await dialog.getByLabel('Alert title').fill('Token refresh errors above 10%')
  await dialog.getByRole('button', { name: 'Send alert' }).click()

  await expect(page.getByRole('heading', { name: 'Token refresh errors above 10%' })).toBeVisible()
  await expect(page.getByText('Alert received', { exact: true })).toBeVisible()

  // Navigate in-app: a full reload would reset the in-browser demo data.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Status page' }).click()
  const main = page.locator('#main')
  await expect(main.getByText('Major outage in progress')).toBeVisible()
  await expect(main.getByText('Token refresh errors above 10%')).toBeVisible()
})

test('public status page renders without a session', async ({ page }) => {
  await json(page, '/api/v1/status/acme', 200, {
    organization_name: 'Acme',
    organization_slug: 'acme',
    overall_status: 'degraded',
    services: [{ id: 's1', name: 'Checkout', description: 'Hosted checkout', status: 'degraded' }],
    active_incidents: [{ id: 'i1', service_id: 's1', title: 'Slow checkout', severity: 'sev2', status: 'identified', created_at: new Date().toISOString() }],
    generated_at: new Date().toISOString(),
  })
  await page.goto('/status/acme')
  await expect(page.getByRole('heading', { name: 'Acme' })).toBeVisible()
  await expect(page.getByText('Some systems are degraded')).toBeVisible()
  await expect(page.getByText('Slow checkout')).toBeVisible()
})

test('sign-up shows field-level validation errors from the API', async ({ page }) => {
  await json(page, '/health', 200, { status: 'ok' })
  await json(page, '/api/v1/auth/register', 422, {
    detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }],
  })
  await page.goto('/')
  await page.getByLabel('Your name').fill('Alex Morgan')
  await page.getByLabel('Organization').fill('Acme')
  await page.getByLabel('Work email').fill('alex@example.com')
  await page.getByLabel(/Password/).fill('long-enough-password')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email: value is not a valid email address')
})
