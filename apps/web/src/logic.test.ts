import { describe, expect, it } from 'vitest'

import { resolveEntry } from './App'
import { createDemoApi, DEMO_SEV1_INCIDENT, DEMO_TOKEN } from './demo/demoApi'
import { duration } from './lib/format'
import { servicesAtRisk } from './lib/graph'
import { parseRoute } from './lib/router'
import type { Dependency, Service } from './types'

const service = (id: string, status: Service['status']): Service =>
  ({ id, organization_id: 'o', name: id, slug: id, description: '', status, created_at: '' })
const edge = (source: string, target: string): Dependency =>
  ({ id: `${source}-${target}`, organization_id: 'o', source_service_id: source, target_service_id: target, relationship: 'depends_on', created_at: '' })

describe('servicesAtRisk', () => {
  it('walks dependents transitively and survives cycles', () => {
    const services = [service('db', 'outage'), service('api', 'operational'), service('web', 'operational'), service('mail', 'operational')]
    const risk = servicesAtRisk(services, [edge('api', 'db'), edge('web', 'api'), edge('db', 'web')])
    expect([...risk.keys()].sort()).toEqual(['api', 'web'])
    expect(risk.get('web')).toEqual(['db'])
    expect(risk.has('mail')).toBe(false)
  })
})

describe('routing', () => {
  it('parses console hashes and entry paths', () => {
    expect(parseRoute('#/incidents/abc')).toEqual({ page: 'incident', id: 'abc' })
    expect(parseRoute('#/team')).toEqual({ page: 'team' })
    expect(parseRoute('#/nope')).toEqual({ page: 'overview' })
    expect(resolveEntry('/status/acme%20co')).toEqual({ kind: 'status', slug: 'acme co' })
    expect(resolveEntry('/demo/')).toEqual({ kind: 'demo' })
    expect(resolveEntry('/invite/tok')).toEqual({ kind: 'app', invitationToken: 'tok' })
  })
})

describe('duration', () => {
  it('formats minutes, hours and days', () => {
    const now = Date.parse('2026-01-03T00:00:00Z')
    expect(duration('2026-01-02T23:15:00Z', null, now)).toBe('45m')
    expect(duration('2026-01-02T21:30:00Z', null, now)).toBe('2h 30m')
    expect(duration('2025-12-30T00:00:00Z', null, now)).toBe('4d 0h')
  })
})

describe('demo API', () => {
  it('enforces the same service-health rules as the server', async () => {
    const api = createDemoApi()
    const org = 'demo-org'
    await expect(api.updateServiceStatus(org, 'svc-payments-api', 'operational', DEMO_TOKEN)).rejects.toMatchObject({ status: 409 })
    for (const status of ['monitoring', 'resolved'] as const) await api.updateIncidentStatus(org, DEMO_SEV1_INCIDENT, status, null, DEMO_TOKEN)
    const overview = await api.overview(org, DEMO_TOKEN)
    expect(overview.services.find((item) => item.id === 'svc-payments-api')?.status).toBe('operational')
    await expect(api.updateIncidentStatus(org, DEMO_SEV1_INCIDENT, 'monitoring', null, DEMO_TOKEN)).rejects.toMatchObject({ status: 409 })
    const postmortem = await api.generatePostmortem(org, DEMO_SEV1_INCIDENT, DEMO_TOKEN)
    expect(postmortem.root_cause).toMatch(/Pending engineering review/)
  })
})
