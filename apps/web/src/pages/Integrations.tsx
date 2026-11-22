import { useState, type FormEvent } from 'react'
import { Copy, KeyRound, RotateCcw, Webhook } from 'lucide-react'

import { API_URL } from '../api'
import { useClient } from '../client'
import { useConsole } from '../console/context'
import { sentence, timeAgo } from '../lib/format'
import { canAdminister, canViewWebhooks } from '../lib/roles'
import type { ApiKeyCreated, ApiKeySummary, WebhookCreated, WebhookEndpoint } from '../types'
import { StatusBadge } from '../ui/Badges'
import { useFeedback } from '../ui/Feedback'
import { useAction, useResource } from '../ui/hooks'
import { Empty, ErrorState, Loading, PageHeader, Panel, Spinner } from '../ui/Layout'

const webhookEvents: { value: string; label: string }[] = [
  { value: 'incident.created', label: 'Incident declared' },
  { value: 'incident.updated', label: 'Incident status changed' },
  { value: 'incident.resolved', label: 'Incident resolved' },
  { value: 'incident.task_created', label: 'Task added' },
  { value: 'incident.task_updated', label: 'Task updated' },
  { value: 'alert.triggered', label: 'Alert opened an incident' },
  { value: 'alert.deduplicated', label: 'Repeat alert grouped' },
  { value: 'service.status_changed', label: 'Service status changed' },
]

function useCopy() {
  const { toast } = useFeedback()
  return async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast(`${label} copied`)
    } catch {
      toast('Copy failed – select the text and copy it manually', 'error')
    }
  }
}

function SecretReveal({ label, value, note }: { label: string; value: string; note: string }) {
  const copy = useCopy()
  return (
    <div className="secret" role="status">
      <b>{label}</b>
      <div className="secret-line">
        <code>{value}</code>
        <button type="button" className="button" onClick={() => copy(value, label)}><Copy size={14} />Copy</button>
      </div>
      <p>{note}</p>
    </div>
  )
}

export function IntegrationsPage() {
  const { membership } = useConsole()
  const admin = canAdminister(membership.role)
  const webhooks = canViewWebhooks(membership.role)
  return (
    <>
      <PageHeader title="Integrations" description="Send alerts in from your monitoring tools and push incident events out to yours." />
      {!webhooks ? (
        <Panel><Empty icon={<KeyRound size={20} />} title="Integrations are managed by engineers and admins">Ask a workspace admin if you need an alert key or a webhook.</Empty></Panel>
      ) : (
        <div className="stack">
          {admin && <ApiKeys />}
          <Quickstart />
          <Webhooks manage={admin} />
        </div>
      )}
    </>
  )
}

function ApiKeys() {
  const { client } = useClient()
  const { organizationId, token } = useConsole()
  const { confirm } = useFeedback()
  const keys = useResource(() => client.apiKeys(organizationId, token), organizationId)
  const { pending, run } = useAction()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<ApiKeyCreated | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    const result = await run('create', () => client.createApiKey(organizationId, name.trim(), token), 'Alert key created')
    if (!result) return
    setCreated(result); setName('')
    await keys.reload()
  }

  async function revoke(key: ApiKeySummary) {
    const ok = await confirm({
      title: `Revoke “${key.name}”?`,
      body: 'Monitoring tools using this key will be rejected immediately. This can’t be undone.',
      confirmLabel: 'Revoke key',
      destructive: true,
    })
    if (!ok) return
    if (await run(key.id, () => client.revokeApiKey(organizationId, key.id, token).then(() => true), 'Key revoked')) {
      if (created?.id === key.id) setCreated(null)
      await keys.reload()
    }
  }

  return (
    <Panel title="Alert keys" description="Each monitoring tool gets its own key. Keys are stored hashed, so they’re shown only once.">
      {created && <SecretReveal label="New alert key" value={created.key} note="Copy it now. Aegis keeps only a hash and can’t show it again." />}
      {keys.error ? <ErrorState message={keys.error} retry={keys.reload} /> : !keys.data ? <Loading /> : keys.data.length === 0 ? (
        <p className="muted-text">No keys yet. Create one for each tool that should open incidents.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Last used</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {keys.data.map((key) => (
                <tr key={key.id}>
                  <th scope="row" data-label="Name"><b>{key.name}</b><small>Created {timeAgo(key.created_at)}</small></th>
                  <td data-label="Key"><code>{key.key_prefix}…</code></td>
                  <td data-label="Last used">{key.last_used_at ? timeAgo(key.last_used_at) : <span className="muted-text">Never</span>}</td>
                  <td className="cell-actions"><button type="button" className="button ghost-danger" disabled={pending === key.id} onClick={() => revoke(key)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="inline-form" onSubmit={create}>
        <label className="sr-only" htmlFor="key-name">Key name</label>
        <input id="key-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it after the tool, e.g. Prometheus" />
        <button className="button primary" disabled={pending === 'create'}>{pending === 'create' && <Spinner />}Create key</button>
      </form>
    </Panel>
  )
}

function Quickstart() {
  const { overview } = useConsole()
  const copy = useCopy()
  const slug = overview.services[0]?.slug ?? 'your-service-slug'
  const command = `curl -X POST ${API_URL}/api/v1/alerts/ingest \\
  -H "X-Aegis-Key: $AEGIS_ALERT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "service_slug": "${slug}",
    "title": "Error rate above 5%",
    "severity": "sev2",
    "source": "prometheus",
    "fingerprint": "${slug}:error-rate"
  }'`
  return (
    <Panel title="Send an alert" description="Point any tool that can make an HTTP request at this endpoint."
      actions={<button type="button" className="button" onClick={() => copy(command, 'Command')}><Copy size={14} />Copy</button>}>
      <pre className="code"><code>{command}</code></pre>
      <ul className="plain-list">
        <li>A new alert opens an incident and marks the service degraded, or in outage for SEV1.</li>
        <li>Alerts with the same source and fingerprint join the open incident instead of creating another.</li>
        <li>The key decides the workspace; a slug from another workspace returns 404.</li>
      </ul>
    </Panel>
  )
}

function Webhooks({ manage }: { manage: boolean }) {
  const { client } = useClient()
  const { organizationId, token, revision } = useConsole()
  const endpoints = useResource(() => client.webhooks(organizationId, token), organizationId)
  const deliveries = useResource(() => client.webhookDeliveries(organizationId, token), `${organizationId}:${revision}`)
  const { pending, run } = useAction()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['incident.created', 'incident.resolved'])
  const [created, setCreated] = useState<WebhookCreated | null>(null)
  const endpointNames = new Map((endpoints.data ?? []).map((endpoint) => [endpoint.id, endpoint.name]))

  async function create(event: FormEvent) {
    event.preventDefault()
    const result = await run('create', () => client.createWebhook(organizationId, { name: name.trim(), url: url.trim(), event_types: events }, token), 'Webhook added')
    if (!result) return
    setCreated(result); setName(''); setUrl('')
    await endpoints.reload()
  }

  async function toggle(endpoint: WebhookEndpoint) {
    if (await run(endpoint.id, () => client.setWebhookEnabled(organizationId, endpoint.id, !endpoint.enabled, token), endpoint.enabled ? 'Webhook paused' : 'Webhook resumed')) await endpoints.reload()
  }

  async function retry(id: string) {
    if (await run(id, () => client.retryWebhookDelivery(organizationId, id, token), 'Delivery queued again')) await deliveries.reload()
  }

  return (
    <Panel title="Webhooks" description="Aegis signs every request with HMAC-SHA256 over the timestamp and body, and retries failures with backoff.">
      {created && <SecretReveal label="Signing secret" value={created.signing_secret} note="Use it to verify the X-Aegis-Signature header. It isn’t shown again." />}
      {endpoints.error ? <ErrorState message={endpoints.error} retry={endpoints.reload} /> : !endpoints.data ? <Loading /> : endpoints.data.length === 0 ? (
        <p className="muted-text">No endpoints yet.</p>
      ) : (
        <ul className="endpoint-list">
          {endpoints.data.map((endpoint) => (
            <li key={endpoint.id}>
              <span className={`endpoint-state ${endpoint.enabled ? 'on' : 'off'}`} aria-hidden="true" />
              <span className="endpoint-main">
                <b>{endpoint.name}{!endpoint.enabled && <span className="muted-text"> (paused)</span>}</b>
                <code>{endpoint.url}</code>
                <small>{endpoint.event_types.length ? endpoint.event_types.map((type) => webhookEvents.find((item) => item.value === type)?.label ?? type).join(', ') : 'All events'}</small>
              </span>
              {manage && <button type="button" className="button" disabled={pending === endpoint.id} onClick={() => toggle(endpoint)}>{endpoint.enabled ? 'Pause' : 'Resume'}</button>}
            </li>
          ))}
        </ul>
      )}

      {manage && (
        <details className="disclosure">
          <summary>Add an endpoint</summary>
          <form className="form" onSubmit={create}>
            <div className="field-row">
              <label className="field"><span>Name</span><input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack relay" /></label>
              <label className="field"><span>HTTPS URL</span><input required type="url" pattern="https://.*" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/aegis" /></label>
            </div>
            <fieldset className="checks">
              <legend>Send these events</legend>
              {webhookEvents.map((item) => (
                <label key={item.value} className="check">
                  <input type="checkbox" checked={events.includes(item.value)} onChange={() => setEvents((current) => current.includes(item.value) ? current.filter((value) => value !== item.value) : [...current, item.value])} />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            <p className="hint">Private and internal addresses are rejected, and the host is checked again before every delivery.</p>
            <div><button className="button primary" disabled={pending === 'create' || events.length === 0}>{pending === 'create' && <Spinner />}Add endpoint</button></div>
          </form>
        </details>
      )}

      <h3 className="subhead"><Webhook size={15} aria-hidden="true" />Recent deliveries</h3>
      {deliveries.error ? <ErrorState message={deliveries.error} retry={deliveries.reload} /> : !deliveries.data ? <Loading /> : deliveries.data.length === 0 ? (
        <p className="muted-text">Deliveries appear here once an event fires for an enabled endpoint.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Event</th><th scope="col">Endpoint</th><th scope="col">Result</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {deliveries.data.slice(0, 25).map((delivery) => (
                <tr key={delivery.id}>
                  <th scope="row" data-label="Event"><b>{webhookEvents.find((item) => item.value === delivery.event_type)?.label ?? sentence(delivery.event_type)}</b><small>{timeAgo(delivery.created_at)}</small></th>
                  <td data-label="Endpoint">{endpointNames.get(delivery.endpoint_id) ?? 'Removed endpoint'}</td>
                  <td data-label="Result">
                    {delivery.response_status ? `HTTP ${delivery.response_status}` : delivery.last_error ? 'No response' : '–'}
                    <small>{delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}</small>
                    {delivery.last_error && <small className="error-text">{delivery.last_error}</small>}
                  </td>
                  <td data-label="Status"><StatusBadge status={delivery.status} /></td>
                  <td className="cell-actions">
                    {(delivery.status === 'failed' || delivery.status === 'dead_letter') && (
                      <button type="button" className="button" disabled={pending === delivery.id} onClick={() => retry(delivery.id)}><RotateCcw size={14} />Retry</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
