/**
 * In-browser stand-in for the Aegis API, used by the hosted demo (which has no backend).
 * It mirrors the server's rules that the UI depends on – service health invariants,
 * lifecycle ordering, alert deduplication on simulate, role-free single-owner access –
 * so the demo exercises the real console code paths. State lives only in this tab.
 */
import { ApiError } from '../api'
import type { ApiClient } from '../client'
import type {
  ApiKeyCreated, ApiKeySummary, AuditEvent, Dependency, Incident, IncidentDetail, IncidentEvent, IncidentStatus,
  IncidentTask, Membership, OrganizationMember, Overview, Postmortem, PublicStatus, Role, Service, ServiceStatus,
  Severity, TaskStatus, User, WebhookCreated, WebhookDelivery, WebhookEndpoint,
} from '../types'

const MIN = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString()
let counter = 0
const hex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const id = () => `${hex(8)}-${(++counter).toString(16).padStart(4, '0')}-4${hex(3)}-8${hex(3)}-${hex(12)}`
const clone = <T,>(value: T): T => structuredClone(value)
const wait = <T,>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(clone(value)), 120))

export const DEMO_SEV1_INCIDENT = 'e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01'
export const DEMO_TOKEN = 'demo-session'
const ORG = 'demo-org'

export const demoUser: User = { id: 'demo-user', email: 'alex.rivera@northwind.example', full_name: 'Alex Rivera', created_at: ago(60 * 24 * 120) }

function seed() {
  const organization = { id: ORG, name: 'Northwind Payments', slug: 'northwind-payments', created_at: ago(60 * 24 * 120) }
  const members: OrganizationMember[] = [
    { user_id: demoUser.id, email: demoUser.email, full_name: demoUser.full_name, role: 'owner', joined_at: ago(60 * 24 * 120) },
    { user_id: 'demo-sam', email: 'sam.okafor@northwind.example', full_name: 'Sam Okafor', role: 'engineer', joined_at: ago(60 * 24 * 90) },
    { user_id: 'demo-priya', email: 'priya.natarajan@northwind.example', full_name: 'Priya Natarajan', role: 'responder', joined_at: ago(60 * 24 * 40) },
    { user_id: 'demo-mei', email: 'mei.chen@northwind.example', full_name: 'Mei Chen', role: 'viewer', joined_at: ago(60 * 24 * 12) },
  ]
  const service = (key: string, name: string, description: string, status: ServiceStatus, days: number): Service => ({
    id: `svc-${key}`, organization_id: ORG, name, slug: `${key}-7f3a`, description, status, created_at: ago(60 * 24 * days),
  })
  const services: Service[] = [
    service('payments-api', 'Payments API', 'Card authorization and capture', 'outage', 110),
    service('checkout-web', 'Checkout', 'Hosted checkout pages', 'operational', 110),
    service('identity', 'Identity', 'Sign-in and session tokens', 'operational', 105),
    service('ledger-worker', 'Ledger worker', 'Settlement and balance updates', 'operational', 100),
    service('search', 'Merchant search', 'Dashboard search index', 'degraded', 80),
    service('notifications', 'Notifications', 'Email and SMS receipts', 'operational', 60),
  ]
  const dependency = (source: string, target: string, days: number): Dependency => ({
    id: id(), organization_id: ORG, source_service_id: `svc-${source}`, target_service_id: `svc-${target}`, relationship: 'depends_on', created_at: ago(60 * 24 * days),
  })
  const dependencies: Dependency[] = [
    dependency('checkout-web', 'payments-api', 90),
    dependency('checkout-web', 'identity', 90),
    dependency('payments-api', 'ledger-worker', 85),
    dependency('notifications', 'payments-api', 50),
  ]

  const incidents: IncidentDetail[] = []
  const add = (incident: Omit<IncidentDetail, 'organization_id'>) => incidents.push({ ...incident, organization_id: ORG })
  const ev = (incidentId: string, minutes: number, event_type: string, message: string, actor_id: string | null, event_metadata: Record<string, unknown> = {}): IncidentEvent => ({
    id: id(), incident_id: incidentId, actor_id, event_type, message, event_metadata, created_at: ago(minutes),
  })
  const task = (incidentId: string, title: string, status: TaskStatus, minutes: number, assigned: string | null = null): IncidentTask => ({
    id: id(), incident_id: incidentId, assigned_to_id: assigned, title, status, created_at: ago(minutes), completed_at: status === 'done' ? ago(minutes - 6) : null,
  })

  add({
    id: 'e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', service_id: 'svc-payments-api', created_by_id: null, commander_id: demoUser.id,
    title: 'Card authorizations failing for EU issuers', summary: 'Roughly 30% of EU card authorizations return a gateway timeout. Checkout shows a generic payment error; US and UK traffic is unaffected.',
    severity: 'sev1', status: 'identified', created_at: ago(26), resolved_at: null,
    events: [
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 26, 'alert.triggered', 'Alert received from prometheus; incident created automatically.', null, { source: 'prometheus' }),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 24, 'alert.deduplicated', 'Repeated alert received from prometheus and attached to the active incident.', null, { source: 'prometheus' }),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 22, 'note.added', 'Taking command. Timeouts start 14:02, matching the connection pool change in deploy 4512.', demoUser.id),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 19, 'task.created', 'Task created: Roll back deploy 4512 on payments-api', 'demo-sam'),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 17, 'task.created', 'Task created: Confirm acquirer status with EU processor', 'demo-priya'),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 12, 'incident.status_changed', 'Pool size for the EU acquirer dropped from 64 to 8 in 4512. Rolling back.', 'demo-sam', { from: 'investigating', to: 'identified' }),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 9, 'task.status_changed', "Task 'Confirm acquirer status with EU processor' changed from todo to done.", 'demo-priya'),
      ev('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 4, 'note.added', 'Rollback at 60%. Error rate falling: 31% to 12%.', 'demo-sam'),
    ],
    tasks: [
      task('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 'Roll back deploy 4512 on payments-api', 'doing', 19, 'demo-sam'),
      task('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 'Confirm acquirer status with EU processor', 'done', 17, 'demo-priya'),
      task('e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', 'Post customer update to status page', 'todo', 11),
    ],
  })
  add({
    id: '5bd07c41-2e9a-4f63-8c1d-0a7e3b9f4c02', service_id: 'svc-search', created_by_id: 'demo-sam', commander_id: 'demo-sam',
    title: 'Merchant search results lag behind new transactions', summary: 'New transactions take up to 15 minutes to appear in dashboard search.',
    severity: 'sev3', status: 'monitoring', created_at: ago(170), resolved_at: null,
    events: [
      ev('5bd07c41-2e9a-4f63-8c1d-0a7e3b9f4c02', 170, 'incident.created', 'Incident declared by Sam Okafor', 'demo-sam'),
      ev('5bd07c41-2e9a-4f63-8c1d-0a7e3b9f4c02', 140, 'incident.status_changed', 'Indexer consumer stuck on a poison message; skipped and replayed.', 'demo-sam', { from: 'investigating', to: 'identified' }),
      ev('5bd07c41-2e9a-4f63-8c1d-0a7e3b9f4c02', 95, 'incident.status_changed', 'Backlog draining, lag down to 3 minutes.', 'demo-sam', { from: 'identified', to: 'monitoring' }),
    ],
    tasks: [task('5bd07c41-2e9a-4f63-8c1d-0a7e3b9f4c02', 'Add dead-letter queue to indexer consumer', 'todo', 90, 'demo-sam')],
  })
  add({
    id: '9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', service_id: 'svc-identity', created_by_id: 'demo-priya', commander_id: 'demo-priya',
    title: 'Slow sign-in after session store failover', summary: 'Sign-in p95 rose to 9s for about 40 minutes after the session store failed over.',
    severity: 'sev2', status: 'resolved', created_at: ago(60 * 26), resolved_at: ago(60 * 26 - 47),
    events: [
      ev('9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', 60 * 26, 'incident.created', 'Incident declared by Priya Natarajan', 'demo-priya'),
      ev('9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', 60 * 26 - 15, 'incident.status_changed', 'Replica promoted with a cold cache; warming it from the primary snapshot.', 'demo-priya', { from: 'investigating', to: 'identified' }),
      ev('9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', 60 * 26 - 35, 'incident.status_changed', 'Cache warm. p95 back under 400ms.', 'demo-priya', { from: 'identified', to: 'monitoring' }),
      ev('9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', 60 * 26 - 47, 'incident.status_changed', 'Stable for 10 minutes. Resolving.', 'demo-priya', { from: 'monitoring', to: 'resolved' }),
    ],
    tasks: [task('9c4e2a17-6d3b-4a85-b0f2-71e8c5d3a903', 'Pre-warm session cache on failover', 'done', 60 * 26 - 20, 'demo-priya')],
  })
  add({
    id: '2f8b6d03-c1a7-4e59-9d24-8a6f0e1b7c04', service_id: 'svc-notifications', created_by_id: null, commander_id: null,
    title: 'Receipt emails delayed', summary: 'Email provider throttled outbound receipts.',
    severity: 'sev4', status: 'resolved', created_at: ago(60 * 24 * 9), resolved_at: ago(60 * 24 * 9 - 95),
    events: [
      ev('2f8b6d03-c1a7-4e59-9d24-8a6f0e1b7c04', 60 * 24 * 9, 'alert.triggered', 'Alert received from datadog; incident created automatically.', null, { source: 'datadog' }),
      ev('2f8b6d03-c1a7-4e59-9d24-8a6f0e1b7c04', 60 * 24 * 9 - 95, 'incident.status_changed', 'Provider lifted throttle; queue drained.', 'demo-sam', { from: 'monitoring', to: 'resolved' }),
    ],
    tasks: [],
  })

  const apiKeys: ApiKeySummary[] = [
    { id: id(), name: 'Prometheus Alertmanager', key_prefix: 'aeg_live_Q3vT9x', last_used_at: ago(24), created_at: ago(60 * 24 * 80) },
    { id: id(), name: 'Datadog', key_prefix: 'aeg_live_m2Lp0c', last_used_at: ago(60 * 24 * 9), created_at: ago(60 * 24 * 60) },
  ]
  const webhooks: WebhookEndpoint[] = [
    { id: 'wh-slack', name: 'Slack #incidents relay', url: 'https://hooks.northwind.example/aegis/slack', event_types: ['incident.created', 'incident.updated', 'incident.resolved'], enabled: true, created_at: ago(60 * 24 * 70), updated_at: ago(60 * 24 * 70) },
    { id: 'wh-pager', name: 'On-call paging bridge', url: 'https://pager.northwind.example/hooks/aegis', event_types: ['alert.triggered'], enabled: true, created_at: ago(60 * 24 * 70), updated_at: ago(60 * 24 * 70) },
  ]
  const delivery = (endpoint: string, event_type: string, status: WebhookDelivery['status'], minutes: number, response_status: number | null, last_error: string | null = null, attempts = 1): WebhookDelivery => ({
    id: id(), endpoint_id: endpoint, event_type, status, attempts, response_status, last_error, created_at: ago(minutes), updated_at: ago(minutes),
  })
  const deliveries: WebhookDelivery[] = [
    delivery('wh-slack', 'incident.updated', 'succeeded', 12, 200),
    delivery('wh-pager', 'alert.triggered', 'failed', 26, 503, 'Endpoint returned HTTP 503', 3),
    delivery('wh-slack', 'incident.updated', 'succeeded', 95, 200),
    delivery('wh-slack', 'incident.updated', 'succeeded', 140, 200),
  ]
  const audit: AuditEvent[] = [
    { id: id(), organization_id: ORG, actor_id: 'demo-sam', action: 'incident.status_changed', resource_type: 'incident', resource_id: 'e3a91f20-7b4c-4d1e-9a02-5c8b1f6d2e01', details: { from: 'investigating', to: 'identified' }, created_at: ago(12) },
    { id: id(), organization_id: ORG, actor_id: null, action: 'alert.ingested', resource_type: 'alert', resource_id: id(), details: { source: 'prometheus', api_key_prefix: 'aeg_live_Q3vT9x' }, created_at: ago(26) },
    { id: id(), organization_id: ORG, actor_id: demoUser.id, action: 'organization.invitation_created', resource_type: 'invitation', resource_id: id(), details: { email: 'mei.chen@northwind.example', role: 'viewer' }, created_at: ago(60 * 24 * 12) },
    { id: id(), organization_id: ORG, actor_id: demoUser.id, action: 'developer.api_key_created', resource_type: 'api_key', resource_id: id(), details: { name: 'Datadog', key_prefix: 'aeg_live_m2Lp0c' }, created_at: ago(60 * 24 * 60) },
  ]
  const membership: Membership = { organization, role: 'owner' }
  return { membership, members, services, dependencies, incidents, apiKeys, webhooks, deliveries, audit, postmortems: [] as Postmortem[] }
}

export function createDemoApi(): ApiClient {
  const db = seed()

  const fail = (status: number, message: string): never => { throw new ApiError(status, message) }
  const findIncident = (incidentId: string) => db.incidents.find((item) => item.id === incidentId) ?? fail(404, 'Incident not found')
  const findService = (serviceId: string) => db.services.find((item) => item.id === serviceId) ?? fail(404, 'Service not found')
  const summary = ({ events: _events, tasks: _tasks, ...incident }: IncidentDetail): Incident => incident
  const sorted = () => [...db.incidents].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const log = (action: string, resource_type: string, resource_id: string, details: Record<string, unknown> = {}) => {
    db.audit.unshift({ id: id(), organization_id: ORG, actor_id: demoUser.id, action, resource_type, resource_id, details, created_at: new Date().toISOString() })
  }
  const deliver = (event_type: string) => {
    for (const endpoint of db.webhooks) {
      if (!endpoint.enabled || (endpoint.event_types.length && !endpoint.event_types.includes(event_type))) continue
      db.deliveries.unshift({ id: id(), endpoint_id: endpoint.id, event_type, status: 'succeeded', attempts: 1, response_status: 200, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    }
  }
  const event = (incident: IncidentDetail, event_type: string, message: string, metadata: Record<string, unknown> = {}, actor: string | null = demoUser.id) => {
    incident.events.push({ id: id(), incident_id: incident.id, actor_id: actor, event_type, message, event_metadata: metadata, created_at: new Date().toISOString() })
  }
  const unresolvedFor = (serviceId: string, except?: string) => db.incidents.some((item) => item.service_id === serviceId && item.id !== except && item.status !== 'resolved')
  const openIncident = (payload: { title: string; summary: string; severity: Severity; service_id: string | null }, fromAlert: boolean) => {
    const incident: IncidentDetail = {
      id: id(), organization_id: ORG, service_id: payload.service_id, created_by_id: fromAlert ? null : demoUser.id, commander_id: fromAlert ? null : demoUser.id,
      title: payload.title, summary: payload.summary, severity: payload.severity, status: 'investigating', created_at: new Date().toISOString(), resolved_at: null, events: [], tasks: [],
    }
    db.incidents.push(incident)
    return incident
  }

  const client: ApiClient = {
    register: () => fail(400, 'Account creation is disabled in the demo.'),
    login: () => fail(400, 'Sign-in is disabled in the demo.'),
    me: () => wait(demoUser),
    memberships: () => wait([db.membership]),
    realtimeTicket: () => fail(503, 'Realtime is not available in the demo.'),
    overview: () => {
      const all = sorted()
      return wait<Overview>({
        services_total: db.services.length,
        services_impacted: db.services.filter((service) => service.status !== 'operational').length,
        active_incidents: all.filter((item) => item.status !== 'resolved').length,
        sev1_incidents: all.filter((item) => item.status !== 'resolved' && item.severity === 'sev1').length,
        services: [...db.services].sort((a, b) => a.name.localeCompare(b.name)),
        incidents: all.slice(0, 20).map(summary),
      })
    },

    createService: (_org, payload) => {
      if (payload.name.trim().length < 2) fail(422, 'Name: should have at least 2 characters')
      const slug = `${payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(16).slice(2, 6)}`
      const service: Service = { id: id(), organization_id: ORG, name: payload.name.trim(), slug, description: payload.description, status: 'operational', created_at: new Date().toISOString() }
      db.services.push(service)
      log('service.created', 'service', service.id, { name: service.name })
      return wait(service)
    },
    updateServiceStatus: (_org, serviceId, status) => {
      const service = findService(serviceId)
      if (service.status === status) fail(409, 'Service is already in that status')
      if (status === 'operational' && unresolvedFor(service.id)) fail(409, 'Resolve active incidents before marking the service operational')
      log('service.status_changed', 'service', service.id, { from: service.status, to: status })
      service.status = status as ServiceStatus
      deliver('service.status_changed')
      return wait(service)
    },
    simulateAlert: (_org, payload) => {
      const service = findService(payload.service_id)
      service.status = 'outage'
      const incident = openIncident({ title: payload.title, summary: `Automatically opened after a simulated critical alert for ${service.name}.`, severity: payload.severity, service_id: service.id }, true)
      incident.commander_id = demoUser.id
      incident.created_by_id = demoUser.id
      event(incident, 'alert.triggered', `Critical alert received for ${service.name}; incident created automatically.`, { source: 'aegis-simulator' })
      deliver('alert.triggered')
      return wait(summary(incident))
    },

    createIncident: (_org, payload) => {
      if (payload.service_id) {
        const service = findService(payload.service_id)
        if (service.status === 'operational') service.status = 'degraded'
      }
      const incident = openIncident(payload, false)
      event(incident, 'incident.created', `Incident declared by ${demoUser.full_name}`)
      log('incident.created', 'incident', incident.id, { severity: incident.severity, title: incident.title })
      deliver('incident.created')
      return wait(summary(incident))
    },
    updateIncidentStatus: (_org, incidentId, status: IncidentStatus, message) => {
      const incident = findIncident(incidentId)
      if (incident.status === status) fail(409, 'Incident is already in that status')
      if (incident.status === 'resolved') fail(409, 'Resolved incidents cannot be reopened')
      const previous = incident.status
      incident.status = status
      if (status === 'resolved') {
        incident.resolved_at = new Date().toISOString()
        if (incident.service_id && !unresolvedFor(incident.service_id, incident.id)) findService(incident.service_id).status = 'operational'
      }
      event(incident, 'incident.status_changed', message || `Status changed from ${previous} to ${status}`, { from: previous, to: status })
      log('incident.status_changed', 'incident', incident.id, { from: previous, to: status })
      deliver(status === 'resolved' ? 'incident.resolved' : 'incident.updated')
      return wait(summary(incident))
    },
    incidents: () => wait(sorted().map(summary)),
    incident: (_org, incidentId) => wait(findIncident(incidentId)),
    addIncidentNote: (_org, incidentId, message) => {
      const incident = findIncident(incidentId)
      event(incident, 'note.added', message)
      return wait(incident)
    },
    createIncidentTask: (_org, incidentId, title) => {
      const incident = findIncident(incidentId)
      const task: IncidentTask = { id: id(), incident_id: incident.id, assigned_to_id: null, title, status: 'todo', created_at: new Date().toISOString(), completed_at: null }
      incident.tasks.push(task)
      event(incident, 'task.created', `Task created: ${title}`)
      deliver('incident.task_created')
      return wait(task)
    },
    updateIncidentTask: (_org, incidentId, taskId, status) => {
      const incident = findIncident(incidentId)
      const task = incident.tasks.find((item) => item.id === taskId) ?? fail(404, 'Incident task not found')
      if (task.status === status) fail(409, 'Task is already in that status')
      event(incident, 'task.status_changed', `Task '${task.title}' changed from ${task.status} to ${status}.`)
      task.status = status
      task.completed_at = status === 'done' ? new Date().toISOString() : null
      deliver('incident.task_updated')
      return wait(task)
    },

    dependencies: () => wait(db.dependencies),
    createDependency: (_org, source, target) => {
      if (source === target) fail(422, 'A service cannot depend on itself')
      if (db.dependencies.some((edge) => edge.source_service_id === source && edge.target_service_id === target)) fail(409, 'Dependency already exists')
      const edge: Dependency = { id: id(), organization_id: ORG, source_service_id: source, target_service_id: target, relationship: 'depends_on', created_at: new Date().toISOString() }
      db.dependencies.push(edge)
      return wait(edge)
    },
    deleteDependency: (_org, dependencyId) => {
      const index = db.dependencies.findIndex((edge) => edge.id === dependencyId)
      if (index < 0) fail(404, 'Dependency not found')
      const [edge] = db.dependencies.splice(index, 1)
      log('dependency.deleted', 'dependency', edge.id, { source_service_id: edge.source_service_id, target_service_id: edge.target_service_id })
      return wait(undefined)
    },
    analytics: () => {
      const since = Date.now() - 30 * 24 * 60 * MIN
      const recent = db.incidents.filter((item) => new Date(item.created_at).getTime() >= since)
      const resolved = recent.filter((item) => item.resolved_at)
      const minutes = resolved.map((item) => (new Date(item.resolved_at!).getTime() - new Date(item.created_at).getTime()) / MIN)
      return wait({
        incidents_30d: recent.length,
        resolved_30d: resolved.length,
        sev1_30d: recent.filter((item) => item.severity === 'sev1').length,
        mean_time_to_resolve_minutes: minutes.length ? Math.round((minutes.reduce((a, b) => a + b, 0) / minutes.length) * 10) / 10 : null,
        current_active: db.incidents.filter((item) => item.status !== 'resolved').length,
        current_impacted_services: db.services.filter((service) => service.status !== 'operational').length,
      })
    },

    apiKeys: () => wait(db.apiKeys),
    createApiKey: (_org, name) => {
      const raw = `aeg_live_demo${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
      const key: ApiKeyCreated = { id: id(), name, key_prefix: raw.slice(0, 18), last_used_at: null, created_at: new Date().toISOString(), key: raw }
      const { key: _secret, ...summaryKey } = key
      db.apiKeys.unshift(summaryKey)
      log('developer.api_key_created', 'api_key', key.id, { name, key_prefix: key.key_prefix })
      return wait(key)
    },
    revokeApiKey: (_org, keyId) => {
      const key = db.apiKeys.find((item) => item.id === keyId) ?? fail(404, 'API key not found')
      db.apiKeys = db.apiKeys.filter((item) => item.id !== keyId)
      log('developer.api_key_revoked', 'api_key', key.id, { name: key.name, key_prefix: key.key_prefix })
      return wait(undefined)
    },

    members: () => wait(db.members),
    createInvitation: (_org, email, role: Role) => {
      if (db.members.some((member) => member.email === email.toLowerCase())) fail(409, 'User is already an organization member')
      log('organization.invitation_created', 'invitation', id(), { email, role })
      return wait({ id: id(), email, role, expires_at: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString(), token: 'demo' })
    },
    previewInvitation: () => fail(404, 'Invitation not found'),
    acceptInvitation: () => fail(400, 'Invitations are disabled in the demo.'),
    updateMemberRole: (_org, userId, role) => {
      const member = db.members.find((item) => item.user_id === userId) ?? fail(404, 'Organization member not found')
      log('organization.member_role_changed', 'membership', userId, { from: member.role, to: role })
      member.role = role
      return wait(member)
    },
    removeMember: (_org, userId) => {
      const member = db.members.find((item) => item.user_id === userId) ?? fail(404, 'Organization member not found')
      db.members = db.members.filter((item) => item.user_id !== userId)
      log('organization.member_removed', 'membership', userId, { role: member.role })
      return wait(undefined)
    },

    webhooks: () => wait(db.webhooks),
    createWebhook: (_org, payload) => {
      if (!payload.url.startsWith('https://')) fail(422, 'Webhook URLs must use HTTPS')
      const endpoint: WebhookCreated = { id: id(), ...payload, enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), signing_secret: `whsec_demo${Math.random().toString(36).slice(2)}` }
      const { signing_secret: _secret, ...stored } = endpoint
      db.webhooks.push(stored)
      log('webhook.created', 'webhook', endpoint.id, { name: endpoint.name })
      return wait(endpoint)
    },
    setWebhookEnabled: (_org, endpointId, enabled) => {
      const endpoint = db.webhooks.find((item) => item.id === endpointId) ?? fail(404, 'Webhook not found')
      endpoint.enabled = enabled
      return wait(endpoint)
    },
    webhookDeliveries: () => wait(db.deliveries),
    retryWebhookDelivery: (_org, deliveryId) => {
      const delivery = db.deliveries.find((item) => item.id === deliveryId) ?? fail(404, 'Webhook delivery not found')
      Object.assign(delivery, { status: 'succeeded', attempts: delivery.attempts + 1, response_status: 200, last_error: null, updated_at: new Date().toISOString() })
      return wait(delivery)
    },

    auditEvents: () => wait(db.audit.slice(0, 50)),
    publicStatus: () => {
      const rank: ServiceStatus[] = ['outage', 'degraded', 'maintenance']
      const overall = rank.find((status) => db.services.some((service) => service.status === status)) ?? 'operational'
      return wait<PublicStatus>({
        organization_name: db.membership.organization.name,
        organization_slug: db.membership.organization.slug,
        overall_status: overall,
        services: db.services.map(({ id: serviceId, name, description, status }) => ({ id: serviceId, name, description, status })),
        active_incidents: sorted().filter((item) => item.status !== 'resolved').map(({ id: incidentId, service_id, created_by_id, title, severity, status, created_at }) => ({
          id: incidentId, service_id, severity, status, created_at,
          // Mirrors the server: alert-opened incidents publish only the affected service.
          title: created_by_id ? title : `Investigating an issue affecting ${db.services.find((item) => item.id === service_id)?.name ?? 'a service'}`,
        })),
        generated_at: new Date().toISOString(),
      })
    },
    postmortem: (_org, incidentId) => wait(db.postmortems.find((item) => item.incident_id === incidentId) ?? fail(404, 'Postmortem has not been generated')),
    generatePostmortem: (_org, incidentId) => {
      const incident = findIncident(incidentId)
      if (incident.status !== 'resolved') fail(409, 'Resolve the incident before generating a postmortem')
      const existing = db.postmortems.find((item) => item.incident_id === incidentId)
      if (existing) return wait(existing)
      const service = incident.service_id ? db.services.find((item) => item.id === incident.service_id) : undefined
      const postmortem: Postmortem = {
        id: id(), incident_id: incident.id, status: 'draft',
        summary: incident.summary || `${incident.title} affected ${service?.name ?? 'production systems'}.`,
        customer_impact: `${service?.name ?? 'A production service'} was impacted during a ${incident.severity.toUpperCase()} incident.`,
        root_cause: 'Pending engineering review. Aegis preserves the incident timeline so the final root cause can be validated rather than guessed.',
        resolution: incident.events.slice(-4).map((item) => item.message).join(' ') || 'Resolution details should be completed by the incident team.',
        follow_up_actions: [
          'Validate the root cause with service owners.',
          'Add or tune an alert that detects the failure mode earlier.',
          'Create a regression test or operational guardrail for the identified failure mode.',
        ],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      db.postmortems.push(postmortem)
      log('postmortem.generated', 'postmortem', postmortem.id, { incident_id: incident.id })
      return wait(postmortem)
    },
    }
  // Match the real client's contract: failures surface as rejected promises, never sync throws.
  const wrapped = Object.fromEntries(Object.entries(client).map(([name, fn]) => [
    name, (...args: unknown[]) => Promise.resolve().then(() => (fn as (...a: unknown[]) => unknown)(...args)),
  ]))
  return wrapped as ApiClient
}
