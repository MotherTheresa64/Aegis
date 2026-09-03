import { expect, test, type Page, type Route } from '@playwright/test'

const origin = 'http://127.0.0.1:4173'
const apiOrigin = 'http://localhost:8000'
const organizationId = '11111111-1111-4111-8111-111111111111'
const serviceId = '22222222-2222-4222-8222-222222222222'
const incidentId = '33333333-3333-4333-8333-333333333333'

const user = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'mobile@example.com',
  full_name: 'Mobile Responder',
  created_at: '2026-09-01T05:00:00Z',
}

const membership = {
  organization: {
    id: organizationId,
    name: 'Mobile Reliability Lab',
    slug: 'mobile-reliability-lab',
    created_at: '2026-09-01T05:00:00Z',
  },
  role: 'owner',
}

function jsonHeaders() {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Aegis-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  }
}

async function mockApi(page: Page) {
  let services = [
    {
      id: serviceId,
      organization_id: organizationId,
      name: 'Payments API',
      slug: 'payments-api-ab12',
      description: 'Routes production authorization traffic.',
      status: 'degraded',
      created_at: '2026-09-01T05:00:00Z',
    },
  ]

  let incident = {
    id: incidentId,
    organization_id: organizationId,
    service_id: serviceId,
    created_by_id: user.id,
    commander_id: user.id,
    title: 'Payment authorization failures',
    summary: 'Authorization failures exceeded the incident threshold.',
    severity: 'sev1',
    status: 'investigating',
    created_at: '2026-09-01T05:15:00Z',
    resolved_at: null as string | null,
  }

  const incidentDetail = () => ({
    ...incident,
    events: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        incident_id: incidentId,
        actor_id: user.id,
        event_type: 'incident.created',
        message: 'Incident declared by Mobile Responder',
        event_metadata: {},
        created_at: '2026-09-01T05:15:00Z',
      },
    ],
    tasks: [],
  })

  const overview = () => ({
    services_total: services.length,
    services_impacted: services.filter((service) => service.status !== 'operational').length,
    active_incidents: incident.status === 'resolved' ? 0 : 1,
    sev1_incidents: incident.status === 'resolved' ? 0 : 1,
    services,
    incidents: [incident],
  })

  const publicStatus = () => ({
    organization_name: membership.organization.name,
    organization_slug: membership.organization.slug,
    overall_status: services.some((service) => service.status !== 'operational') ? 'degraded' : 'operational',
    services,
    active_incidents: incident.status === 'resolved' ? [] : [incident],
    generated_at: '2026-09-01T06:00:00Z',
  })

  async function fulfill(route: Route, status: number, body?: unknown) {
    await route.fulfill({
      status,
      headers: jsonHeaders(),
      body: body === undefined ? '' : JSON.stringify(body),
    })
  }

  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'OPTIONS') {
      await fulfill(route, 204)
      return
    }
    if (path === '/api/v1/auth/me' && request.method() === 'GET') {
      await fulfill(route, 200, user)
      return
    }
    if (path === '/api/v1/auth/memberships' && request.method() === 'GET') {
      await fulfill(route, 200, [membership])
      return
    }
    if (path === `/api/v1/organizations/${organizationId}/overview` && request.method() === 'GET') {
      await fulfill(route, 200, overview())
      return
    }
    if (path === `/api/v1/organizations/${organizationId}/realtime-ticket` && request.method() === 'POST') {
      await fulfill(route, 200, { ticket: 'aeg_rt_mobile-test-ticket', expires_in: 60 })
      return
    }
    if (path === `/api/v1/organizations/${organizationId}/incidents/${incidentId}` && request.method() === 'GET') {
      await fulfill(route, 200, incidentDetail())
      return
    }
    if (path === `/api/v1/organizations/${organizationId}/incidents/${incidentId}/status` && request.method() === 'PATCH') {
      const input = request.postDataJSON() as { status: 'investigating' | 'identified' | 'monitoring' | 'resolved' }
      incident = {
        ...incident,
        status: input.status,
        resolved_at: input.status === 'resolved' ? '2026-09-01T05:45:00Z' : null,
      }
      if (input.status === 'resolved') {
        services = services.map((service) => service.id === serviceId ? { ...service, status: 'operational' } : service)
      }
      await fulfill(route, 200, incident)
      return
    }
    if (path === `/api/v1/organizations/${organizationId}/services` && request.method() === 'POST') {
      const input = request.postDataJSON() as { name: string; description: string }
      const created = {
        id: '66666666-6666-4666-8666-666666666666',
        organization_id: organizationId,
        name: input.name,
        slug: 'billing-worker-ef34',
        description: input.description,
        status: 'operational',
        created_at: '2026-09-01T05:50:00Z',
      }
      services = [...services, created]
      await fulfill(route, 201, created)
      return
    }
    if (path === `/api/v1/status/${membership.organization.slug}` && request.method() === 'GET') {
      await fulfill(route, 200, publicStatus())
      return
    }

    await fulfill(route, 404, { detail: `Unhandled mobile test route: ${request.method()} ${path}` })
  })
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.addInitScript(() => {
    localStorage.setItem('aegis_token', 'mobile-test-token')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Command center' })).toBeVisible()
})

test('mobile navigation, incident response, and service creation remain functional', async ({ page }) => {
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible()
  await expect(page.locator('.sidebar')).toBeHidden()

  await page.getByRole('button', { name: /^Incidents/ }).click()
  const mobileIncidents = page.locator('.mobile-incident-list')
  await expect(mobileIncidents).toBeVisible()
  await expect(page.locator('.desktop-incidents')).toBeHidden()
  await expect(mobileIncidents.getByText('Payment authorization failures')).toBeVisible()

  await page.getByRole('button', { name: 'Open incident' }).click()
  const incidentDialog = page.getByRole('dialog', { name: 'Payment authorization failures' })
  await expect(incidentDialog).toBeVisible()
  await expect(incidentDialog.getByText('Incident timeline', { exact: true })).toBeVisible()
  await incidentDialog.getByRole('button', { name: 'Mark identified' }).click()
  await expect(incidentDialog.getByText('Identified', { exact: true })).toBeVisible()
  await incidentDialog.getByRole('button', { name: 'Close incident' }).click()
  await expect(incidentDialog).toBeHidden()

  await mobileIncidents.getByRole('button', { name: 'Resolve' }).click()
  await expect(mobileIncidents.getByText('Resolved', { exact: true })).toBeVisible()
  await expect(mobileIncidents.getByRole('button', { name: 'Resolve' })).toHaveCount(0)

  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('dialog', { name: 'More navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Close menu' }).click()

  await page.locator('.topbar-add').click()
  const serviceDialog = page.getByRole('dialog', { name: 'Add production service' })
  await expect(serviceDialog).toBeVisible()
  await serviceDialog.getByLabel('Service name').fill('Billing Worker')
  await serviceDialog.getByLabel('Description').fill('Processes asynchronous billing events.')
  await serviceDialog.getByRole('button', { name: 'Create service' }).click()
  await expect(serviceDialog).toBeHidden()

  await page.getByRole('button', { name: /^Services$/ }).click()
  await expect(page.getByRole('heading', { name: 'Billing Worker' })).toBeVisible()
})

test('public status route is usable without an authenticated workspace session', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('aegis_token'))
  await page.goto('/status/mobile-reliability-lab')
  await expect(page.getByRole('heading', { name: /service state|systems operational/i })).toBeVisible()
  await expect(page.getByText('Payments API')).toBeVisible()
  await expect(page.getByText('Payment authorization failures')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Operations console' })).toBeVisible()
})
