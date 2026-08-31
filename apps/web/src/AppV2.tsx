import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Command,
  Cpu,
  ExternalLink,
  Gauge,
  GitBranch,
  KeyRound,
  Link2,
  LogOut,
  Menu,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Siren,
  Terminal,
  X,
  Zap,
} from 'lucide-react'

import { api, ApiError, WS_URL } from './api'
import type {
  AnalyticsOverview,
  ApiKeyCreated,
  ApiKeySummary,
  Dependency,
  Incident,
  IncidentDetail,
  Membership,
  Overview,
  Postmortem,
  PublicStatus,
  Service,
  TaskStatus,
  User,
} from './types'
import './advanced.css'

const TOKEN_KEY = 'aegis_token'
type View = 'command' | 'incidents' | 'services' | 'dependencies' | 'analytics' | 'integrations' | 'status' | 'settings'

const viewMeta: Record<View, { eyebrow: string; title: string; description: string }> = {
  command: { eyebrow: 'LIVE OPERATIONS', title: 'Command center', description: 'Realtime health and incident response across your production surface.' },
  incidents: { eyebrow: 'RESPONSE', title: 'Incidents', description: 'Coordinate active response, review history, and inspect incident timelines.' },
  services: { eyebrow: 'SERVICE CATALOG', title: 'Services', description: 'Production systems monitored by Aegis and their current operational state.' },
  dependencies: { eyebrow: 'TOPOLOGY', title: 'Dependencies', description: 'Model service relationships so responders can reason about blast radius.' },
  analytics: { eyebrow: 'RELIABILITY', title: 'Analytics', description: 'Operational performance, incident volume, severity, and recovery metrics.' },
  integrations: { eyebrow: 'DEVELOPER PLATFORM', title: 'Integrations', description: 'Connect external monitoring systems through scoped, hashed API credentials.' },
  status: { eyebrow: 'CUSTOMER COMMUNICATION', title: 'Status page', description: 'Preview the public operational view generated from your live service state.' },
  settings: { eyebrow: 'WORKSPACE', title: 'Settings', description: 'Organization identity, access role, API endpoints, and platform configuration.' },
}

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill ${status}`}><span className="status-dot" />{titleCase(status)}</span>
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`severity ${severity}`}>{severity.toUpperCase()}</span>
}

function KpiCard({ icon, label, value, hint, tone = '' }: { icon: ReactNode; label: string; value: string | number; hint: string; tone?: string }) {
  return <div className={`kpi-card ${tone}`}><div className="kpi-top"><span className="kpi-icon">{icon}</span><span>{label}</span></div><strong>{value}</strong><small>{hint}</small></div>
}

function ErrorBanner({ message, dismiss }: { message: string; dismiss: () => void }) {
  if (!message) return null
  return <div className="error-banner"><AlertTriangle size={17} /><span>{message}</span><button onClick={dismiss}><X size={15} /></button></div>
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = mode === 'register'
        ? await api.register({ email, password, full_name: fullName, organization_name: organizationName })
        : await api.login({ email, password })
      onAuthenticated(result.access_token, result.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to connect to Aegis.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="auth-shell">
    <div className="auth-grid" />
    <section className="auth-story">
      <div className="brand brand-large"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div>
      <div className="eyebrow"><Radio size={14} /> INCIDENT OPERATIONS, UNIFIED</div>
      <h1>Control the moment<br /><span>systems fail.</span></h1>
      <p>A realtime operations layer for service health, alert ingestion, incident response, customer communication, and recovery.</p>
      <div className="auth-features">
        <div><Zap /><span><b>Realtime response</b><small>Live incident state across every responder.</small></span></div>
        <div><Network /><span><b>Service intelligence</b><small>Understand blast radius and dependencies.</small></span></div>
        <div><ShieldCheck /><span><b>Operational control</b><small>Tenant-aware access and auditable actions.</small></span></div>
      </div>
    </section>
    <section className="auth-panel-wrap">
      <div className="auth-panel">
        <div className="auth-tabs">
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create workspace</button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
        </div>
        <h2>{mode === 'register' ? 'Stand up your command center' : 'Welcome back'}</h2>
        <p>{mode === 'register' ? 'Create an organization and owner account in seconds.' : 'Sign in to your operations workspace.'}</p>
        <form onSubmit={submit}>
          {mode === 'register' && <>
            <label>Full name<input required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Alex Morgan" /></label>
            <label>Organization<input required minLength={2} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Acme Systems" /></label>
          </>}
          <label>Work email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
          {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
          <button className="primary wide" disabled={loading}>{loading ? <RefreshCw className="spin" size={16} /> : <Shield size={16} />}{mode === 'register' ? 'Create Aegis workspace' : 'Enter command center'}</button>
        </form>
        <small className="auth-footnote">Tenant boundaries and role checks are enforced server-side.</small>
      </div>
    </section>
  </div>
}

function IncidentTable({ incidents, busy, onInspect, onResolve }: {
  incidents: Incident[]
  busy: string
  onInspect: (incident: Incident) => void
  onResolve: (incident: Incident) => void
}) {
  if (!incidents.length) return <div className="empty-table"><CheckCircle2 /><b>No incidents recorded</b><span>Trigger a simulation from a service to exercise the response pipeline.</span></div>
  return <div className="incident-table-wrap"><table className="incident-table"><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Started</th><th>Response</th></tr></thead><tbody>
    {incidents.map((incident) => <tr key={incident.id} onClick={() => onInspect(incident)}>
      <td><div className="incident-title"><span className={`incident-beacon ${incident.status}`} /><div><b>{incident.title}</b><small>INC-{incident.id.slice(0, 6).toUpperCase()}</small></div></div></td>
      <td><SeverityBadge severity={incident.severity} /></td>
      <td><StatusPill status={incident.status} /></td>
      <td>{timeAgo(incident.created_at)}</td>
      <td>{incident.status === 'resolved'
        ? <span className="resolved-text"><CheckCircle2 size={14} />Closed</span>
        : <button className="resolve-button" disabled={busy === `resolve-${incident.id}`} onClick={(e) => { e.stopPropagation(); onResolve(incident) }}><CheckCircle2 size={14} />Resolve</button>}
        <ChevronRight className="row-chevron" size={16} />
      </td>
    </tr>)}
  </tbody></table></div>
}

function IncidentDrawer({ incident, organizationId, token, onClose, onChanged }: {
  incident: IncidentDetail
  organizationId: string
  token: string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (incident.status !== 'resolved') { setPostmortem(null); return }
    api.postmortem(organizationId, incident.id, token)
      .then(setPostmortem)
      .catch((err) => { if (!(err instanceof ApiError && err.status === 404)) setError('Could not load postmortem.') })
  }, [incident.id, incident.status, organizationId, token])

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setBusy('note')
    try { await api.addIncidentNote(organizationId, incident.id, note.trim(), token); setNote(''); await onChanged() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not add incident update.') }
    finally { setBusy('') }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault()
    if (!taskTitle.trim()) return
    setBusy('task')
    try { await api.createIncidentTask(organizationId, incident.id, taskTitle.trim(), token); setTaskTitle(''); await onChanged() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create task.') }
    finally { setBusy('') }
  }

  async function cycleTask(taskId: string, current: TaskStatus) {
    const next: TaskStatus = current === 'todo' ? 'doing' : current === 'doing' ? 'done' : 'todo'
    setBusy(`task-${taskId}`)
    try { await api.updateIncidentTask(organizationId, incident.id, taskId, next, token); await onChanged() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not update task.') }
    finally { setBusy('') }
  }

  async function generatePostmortem() {
    setBusy('postmortem')
    try { setPostmortem(await api.generatePostmortem(organizationId, incident.id, token)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not generate postmortem.') }
    finally { setBusy('') }
  }

  return <div className="drawer-backdrop" onMouseDown={onClose}>
    <aside className="incident-drawer incident-drawer-wide" onMouseDown={(e) => e.stopPropagation()}>
      <div className="drawer-header">
        <div><div className="eyebrow"><Siren size={13} /> INCIDENT COMMAND</div><h2>{incident.title}</h2></div>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="incident-meta"><SeverityBadge severity={incident.severity} /><StatusPill status={incident.status} /><span><Clock3 size={14} />{timeAgo(incident.created_at)}</span></div>
      {incident.summary && <p className="incident-summary">{incident.summary}</p>}
      <ErrorBanner message={error} dismiss={() => setError('')} />

      <div className="drawer-grid">
        <section>
          <div className="timeline-title"><span>Incident timeline</span><small>{incident.events.length} events</small></div>
          <div className="timeline">
            {incident.events.map((event, index) => <div className="timeline-event" key={event.id}>
              <div className="timeline-rail"><span className="timeline-node" />{index < incident.events.length - 1 && <span className="timeline-line" />}</div>
              <div><div className="timeline-event-head"><b>{titleCase(event.event_type)}</b><time>{new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{event.message}</p></div>
            </div>)}
          </div>
        </section>

        <section className="response-column">
          <div className="timeline-title"><span>Response tasks</span><small>{incident.tasks.filter((task) => task.status === 'done').length}/{incident.tasks.length} done</small></div>
          <div className="task-list">
            {incident.tasks.length === 0 && <div className="compact-empty">No response tasks yet.</div>}
            {incident.tasks.map((task) => <button key={task.id} className={`task-item ${task.status}`} disabled={busy === `task-${task.id}`} onClick={() => cycleTask(task.id, task.status)}>
              <span className="task-check">{task.status === 'done' ? <CheckCircle2 size={15} /> : task.status === 'doing' ? <RefreshCw size={14} /> : <CircleDot size={14} />}</span>
              <span><b>{task.title}</b><small>{titleCase(task.status)} · click to advance</small></span>
            </button>)}
          </div>
          {incident.status !== 'resolved' && <form className="inline-action-form" onSubmit={addTask}><input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Add response task…" /><button className="secondary" disabled={busy === 'task'}><Plus size={14} />Add</button></form>}

          {incident.status === 'resolved' && <div className="postmortem-card">
            <div className="postmortem-heading"><div><span>POST-INCIDENT</span><b>Postmortem</b></div><Code2 size={18} /></div>
            {!postmortem ? <><p>Generate a structured draft from the preserved incident timeline. Root cause remains explicitly pending engineering validation rather than being fabricated.</p><button className="secondary" disabled={busy === 'postmortem'} onClick={generatePostmortem}>{busy === 'postmortem' ? <RefreshCw className="spin" size={14} /> : <Zap size={14} />}Generate draft</button></> : <div className="postmortem-content">
              <label>Summary<p>{postmortem.summary}</p></label>
              <label>Customer impact<p>{postmortem.customer_impact}</p></label>
              <label>Root cause<p>{postmortem.root_cause}</p></label>
              <label>Resolution<p>{postmortem.resolution}</p></label>
              <label>Follow-up actions<ul>{postmortem.follow_up_actions.map((action) => <li key={action}>{action}</li>)}</ul></label>
            </div>}
          </div>}
        </section>
      </div>

      {incident.status !== 'resolved' && <form className="note-form" onSubmit={addNote}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an incident timeline update…" /><button className="primary" disabled={busy === 'note'}>{busy === 'note' ? <RefreshCw className="spin" size={15} /> : <Command size={15} />}Post update</button></form>}
    </aside>
  </div>
}

function CommandView({ overview, busy, simulate, inspect, resolve, addService }: {
  overview: Overview
  busy: string
  simulate: (service: Service) => void
  inspect: (incident: Incident) => void
  resolve: (incident: Incident) => void
  addService: () => void
}) {
  return <>
    <section className="kpi-grid">
      <KpiCard icon={<Server />} label="Monitored services" value={overview.services_total} hint={overview.services_total ? 'Production catalog' : 'Add your first service'} />
      <KpiCard icon={<Activity />} label="Active incidents" value={overview.active_incidents} hint={overview.active_incidents ? 'Requires attention' : 'No active incidents'} tone={overview.active_incidents ? 'warning' : ''} />
      <KpiCard icon={<Siren />} label="SEV-1 incidents" value={overview.sev1_incidents} hint={overview.sev1_incidents ? 'Immediate response' : 'No critical incidents'} tone={overview.sev1_incidents ? 'critical' : ''} />
      <KpiCard icon={<ShieldCheck />} label="Impacted services" value={overview.services_impacted} hint={overview.services_impacted ? 'Customer impact possible' : 'All systems nominal'} tone={overview.services_impacted ? 'critical' : 'healthy'} />
    </section>

    {overview.services.length === 0 ? <section className="empty-onboarding">
      <div className="empty-graphic"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><Shield /></div>
      <div><div className="eyebrow"><Cpu size={13} /> INITIALIZE AEGIS</div><h2>Connect your first production service.</h2><p>Services become the center of health monitoring, alert routing, incidents, status communication, and dependency intelligence.</p><button className="primary" onClick={addService}><Plus size={16} />Create first service</button></div>
    </section> : <>
      <section className="operations-grid">
        <div className="panel services-panel">
          <div className="panel-head"><div><h2>Service health</h2><p>Current production state</p></div><span className="panel-meta"><Radio size={13} /> LIVE</span></div>
          <div className="service-list">{overview.services.map((service) => <div className="service-row" key={service.id}>
            <div className="service-icon"><Server size={18} /></div>
            <div className="service-name"><b>{service.name}</b><small>{service.description || service.slug}</small></div>
            <StatusPill status={service.status} />
            <button className="simulate-button" disabled={busy === `simulate-${service.id}`} onClick={() => simulate(service)}><Zap size={14} />{busy === `simulate-${service.id}` ? 'Triggering…' : 'Simulate outage'}</button>
          </div>)}</div>
        </div>
        <div className="panel signal-panel">
          <div className="panel-head"><div><h2>Operational signal</h2><p>Environment health score</p></div><Activity size={17} /></div>
          <div className={`health-ring ${overview.services_impacted ? 'unhealthy' : ''}`}><div><strong>{overview.services_total ? Math.max(0, Math.round(((overview.services_total - overview.services_impacted) / overview.services_total) * 100)) : 100}</strong><span>%</span><small>HEALTH</small></div></div>
          <div className="signal-stats"><span><i className="healthy-dot" />Operational<b>{overview.services_total - overview.services_impacted}</b></span><span><i className="impact-dot" />Impacted<b>{overview.services_impacted}</b></span></div>
        </div>
      </section>
      <section className="panel incident-panel"><div className="panel-head"><div><h2>Incident stream</h2><p>Latest operational events and active response</p></div><span className="panel-meta">{overview.incidents.length} RECENT</span></div><IncidentTable incidents={overview.incidents} busy={busy} onInspect={inspect} onResolve={resolve} /></section>
    </>}
  </>
}

function ServicesView({ services, busy, simulate, addService }: { services: Service[]; busy: string; simulate: (service: Service) => void; addService: () => void }) {
  return <section className="platform-card-grid">
    {services.map((service) => <article className="platform-card service-card" key={service.id}>
      <div className="platform-card-head"><span className="service-icon large"><Server size={20} /></span><StatusPill status={service.status} /></div>
      <h3>{service.name}</h3><code>{service.slug}</code><p>{service.description || 'No service description has been provided.'}</p>
      <div className="platform-card-actions"><span>Created {timeAgo(service.created_at)}</span><button className="simulate-button" disabled={busy === `simulate-${service.id}`} onClick={() => simulate(service)}><Zap size={14} />Simulate SEV-1</button></div>
    </article>)}
    <button className="platform-card add-card" onClick={addService}><Plus size={24} /><b>Add production service</b><span>Extend the monitored service catalog.</span></button>
  </section>
}

function DependenciesView({ services, dependencies, busy, create }: { services: Service[]; dependencies: Dependency[]; busy: string; create: (source: string, target: string) => Promise<void> }) {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const byId = useMemo(() => Object.fromEntries(services.map((service) => [service.id, service])), [services])
  async function submit(event: FormEvent) { event.preventDefault(); if (!source || !target) return; await create(source, target); setSource(''); setTarget('') }
  return <div className="split-platform-layout">
    <section className="panel dependency-map-panel"><div className="panel-head"><div><h2>Dependency graph</h2><p>Declared production relationships</p></div><GitBranch size={17} /></div>
      <div className="dependency-list">{dependencies.length === 0 ? <div className="empty-table"><Network /><b>No dependency edges yet</b><span>Connect services to make topology and blast-radius reasoning explicit.</span></div> : dependencies.map((dependency) => <div className="dependency-edge" key={dependency.id}>
        <span className="dependency-node"><Server size={15} />{byId[dependency.source_service_id]?.name || 'Unknown service'}</span><span className="edge-line"><ChevronRight size={15} /><small>{titleCase(dependency.relationship)}</small></span><span className="dependency-node"><Server size={15} />{byId[dependency.target_service_id]?.name || 'Unknown service'}</span>
      </div>)}</div>
    </section>
    <section className="panel form-panel"><div className="panel-head"><div><h2>Declare relationship</h2><p>Source service depends on target</p></div><Link2 size={17} /></div><form onSubmit={submit} className="platform-form"><label>Source service<select required value={source} onChange={(e) => setSource(e.target.value)}><option value="">Choose service</option>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label><label>Depends on<select required value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose service</option>{services.filter((service) => service.id !== source).map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label><button className="primary" disabled={busy === 'dependency' || !source || !target}><Link2 size={15} />Create dependency</button></form></section>
  </div>
}

function AnalyticsView({ data }: { data: AnalyticsOverview | null }) {
  if (!data) return <div className="loading-state"><RefreshCw className="spin" /><span>Calculating reliability metrics…</span></div>
  const mttr = data.mean_time_to_resolve_minutes === null ? '—' : `${data.mean_time_to_resolve_minutes}m`
  const resolutionRate = data.incidents_30d ? Math.round((data.resolved_30d / data.incidents_30d) * 100) : 100
  return <>
    <section className="kpi-grid analytics-kpis">
      <KpiCard icon={<BarChart3 />} label="Incidents / 30d" value={data.incidents_30d} hint={`${data.resolved_30d} resolved`} />
      <KpiCard icon={<Clock3 />} label="Mean time to resolve" value={mttr} hint="Resolved incidents, 30d" />
      <KpiCard icon={<Siren />} label="SEV-1 / 30d" value={data.sev1_30d} hint="Critical reliability events" tone={data.sev1_30d ? 'critical' : ''} />
      <KpiCard icon={<CheckCircle2 />} label="Resolution rate" value={`${resolutionRate}%`} hint="30-day incident cohort" tone="healthy" />
    </section>
    <section className="analytics-layout">
      <div className="panel metric-visual"><div className="panel-head"><div><h2>Recovery effectiveness</h2><p>Current operational snapshot</p></div><Activity size={17} /></div><div className="metric-bars"><div><span>Resolved incidents</span><b>{data.resolved_30d}</b><i><em style={{ width: `${resolutionRate}%` }} /></i></div><div><span>Current active incidents</span><b>{data.current_active}</b><i><em style={{ width: `${Math.min(100, data.current_active * 20)}%` }} /></i></div><div><span>Impacted services</span><b>{data.current_impacted_services}</b><i><em style={{ width: `${Math.min(100, data.current_impacted_services * 20)}%` }} /></i></div></div></div>
      <div className="panel reliability-note"><div className="panel-head"><div><h2>Metric contract</h2><p>How Aegis calculates these numbers</p></div><ShieldCheck size={17} /></div><div className="note-content"><p>MTTR is derived from persisted incident creation and resolution timestamps rather than client-side timers.</p><p>The 30-day cohort is calculated server-side from tenant-scoped PostgreSQL records.</p><p>These metrics are designed to be extended into percentile recovery times, service-level objectives, and trend windows.</p></div></div>
    </section>
  </>
}

function IntegrationsView({ apiKeys, createdKey, role, busy, createKey }: { apiKeys: ApiKeySummary[]; createdKey: ApiKeyCreated | null; role: string; busy: string; createKey: (name: string) => Promise<void> }) {
  const [name, setName] = useState('Production monitoring')
  async function submit(event: FormEvent) { event.preventDefault(); await createKey(name) }
  const canManage = role === 'owner' || role === 'admin'
  return <div className="split-platform-layout integrations-layout">
    <section className="panel"><div className="panel-head"><div><h2>API credentials</h2><p>Keys are hashed at rest and only shown once</p></div><KeyRound size={17} /></div>
      {createdKey && <div className="secret-reveal"><span>NEW KEY — COPY NOW</span><code>{createdKey.key}</code><p>Aegis stores only its SHA-256 digest. This plaintext value cannot be retrieved later.</p></div>}
      <div className="key-list">{apiKeys.length === 0 ? <div className="compact-empty">No API keys created.</div> : apiKeys.map((key) => <div className="key-row" key={key.id}><span className="service-icon"><KeyRound size={15} /></span><div><b>{key.name}</b><code>{key.key_prefix}••••••••</code></div><span>{key.last_used_at ? `Used ${timeAgo(key.last_used_at)}` : 'Never used'}</span></div>)}</div>
      {canManage && <form className="integration-create" onSubmit={submit}><input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /><button className="primary" disabled={busy === 'api-key'}><Plus size={14} />Create API key</button></form>}
    </section>
    <section className="panel developer-quickstart"><div className="panel-head"><div><h2>Alert ingestion</h2><p>Developer quickstart</p></div><Terminal size={17} /></div><div className="code-example"><span>POST /api/v1/alerts/ingest</span><pre>{`curl -X POST "$AEGIS_API/api/v1/alerts/ingest" \\\n  -H "X-Aegis-Key: aeg_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "service_slug": "payments-api-ab12",\n    "title": "Error rate exceeded 15%",\n    "severity": "sev1",\n    "fingerprint": "payments:error-rate",\n    "source": "production-monitor"\n  }'`}</pre></div><div className="integration-notes"><p><b>Fingerprint deduplication</b>Repeated alerts attach to an existing active incident instead of creating alert storms.</p><p><b>Async response</b>Notification work is queued outside request latency.</p><p><b>Tenant isolation</b>The API key resolves the owning organization server-side.</p></div></section>
  </div>
}

function StatusView({ data }: { data: PublicStatus | null }) {
  if (!data) return <div className="loading-state"><RefreshCw className="spin" /><span>Loading public status model…</span></div>
  return <div className="status-preview-wrap"><div className="status-browser-bar"><span /><span /><span /><code>/status/{data.organization_slug}</code><ExternalLink size={14} /></div><section className="public-status-preview"><div className="public-brand"><Shield size={20} /><b>{data.organization_name} Status</b></div><div className={`overall-status ${data.overall_status}`}><span className="overall-icon">{data.overall_status === 'operational' ? <CheckCircle2 /> : <AlertTriangle />}</span><div><h2>{data.overall_status === 'operational' ? 'All systems operational' : `${titleCase(data.overall_status)} service state`}</h2><p>Live status generated from Aegis production service records.</p></div></div><div className="public-services">{data.services.map((service) => <div key={service.id}><span><b>{service.name}</b><small>{service.description || service.slug}</small></span><StatusPill status={service.status} /></div>)}</div>{data.active_incidents.length > 0 && <div className="public-incidents"><h3>Active incidents</h3>{data.active_incidents.map((incident) => <div key={incident.id}><SeverityBadge severity={incident.severity} /><span><b>{incident.title}</b><small>{titleCase(incident.status)} · {timeAgo(incident.created_at)}</small></span></div>)}</div>}<footer>Updated {new Date(data.generated_at).toLocaleString()} · Powered by Aegis</footer></section></div>
}

function SettingsView({ membership, user }: { membership: Membership; user: User }) {
  return <div className="settings-grid">
    <section className="panel settings-card"><div className="panel-head"><div><h2>Organization</h2><p>Tenant identity</p></div><Shield size={17} /></div><dl><div><dt>Name</dt><dd>{membership.organization.name}</dd></div><div><dt>Slug</dt><dd><code>{membership.organization.slug}</code></dd></div><div><dt>Your role</dt><dd><span className="role-badge">{membership.role}</span></dd></div><div><dt>Created</dt><dd>{new Date(membership.organization.created_at).toLocaleDateString()}</dd></div></dl></section>
    <section className="panel settings-card"><div className="panel-head"><div><h2>Identity</h2><p>Authenticated operator</p></div><ShieldCheck size={17} /></div><dl><div><dt>Name</dt><dd>{user.full_name}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>User ID</dt><dd><code>{user.id}</code></dd></div></dl></section>
    <section className="panel settings-card full"><div className="panel-head"><div><h2>Platform boundaries</h2><p>Security and operational design</p></div><Code2 size={17} /></div><div className="boundary-grid"><div><b>Authoritative data</b><span>PostgreSQL</span><p>Tenant, incident, alert, service, task, audit, and postmortem records.</p></div><div><b>Ephemeral infrastructure</b><span>Redis</span><p>Queue, pub/sub, rate-limit, and cache responsibilities; never core business truth.</p></div><div><b>Realtime transport</b><span>WebSockets</span><p>Organization-scoped channels use short-lived, one-time Redis-backed authentication tickets.</p></div><div><b>Async execution</b><span>Celery</span><p>Retryable notification and integration work outside synchronous request latency.</p></div></div></section>
  </div>
}

function Dashboard({ token, user, onLogout }: { token: string; user: User; onLogout: () => void }) {
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [organizationId, setOrganizationId] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [view, setView] = useState<View>('command')
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([])
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [publicStatus, setPublicStatus] = useState<PublicStatus | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [serviceModal, setServiceModal] = useState(false)
  const [serviceName, setServiceName] = useState('')
  const [serviceDescription, setServiceDescription] = useState('')
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const membership = useMemo(() => memberships.find((item) => item.organization.id === organizationId), [memberships, organizationId])
  const activeIncidents = overview?.incidents.filter((incident) => incident.status !== 'resolved') || []

  const loadOverview = useCallback(async (orgId = organizationId) => {
    if (!orgId) return
    try { setOverview(await api.overview(orgId, token)); setError('') }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Unable to load operations data.') }
    finally { setLoading(false) }
  }, [organizationId, token])

  const refreshSelectedIncident = useCallback(async () => {
    if (!selectedIncident || !organizationId) return
    setSelectedIncident(await api.incident(organizationId, selectedIncident.id, token))
  }, [organizationId, selectedIncident?.id, token])

  useEffect(() => {
    api.memberships(token).then((items) => {
      setMemberships(items)
      if (items[0]) setOrganizationId(items[0].organization.id)
      else setLoading(false)
    }).catch(onLogout)
  }, [token])

  useEffect(() => { if (organizationId) void loadOverview(organizationId) }, [organizationId, loadOverview])

  useEffect(() => {
    if (!organizationId || !membership) return
    if (view === 'analytics') api.analytics(organizationId, token).then(setAnalytics).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load analytics.'))
    if (view === 'dependencies') api.dependencies(organizationId, token).then(setDependencies).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load dependencies.'))
    if (view === 'integrations') api.apiKeys(organizationId, token).then(setApiKeys).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load API keys.'))
    if (view === 'status') api.publicStatus(membership.organization.slug).then(setPublicStatus).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load public status.'))
  }, [view, organizationId, membership?.organization.slug, token])

  useEffect(() => {
    if (!organizationId) return

    let socket: WebSocket | null = null
    let keepAlive: number | undefined
    let reconnectTimer: number | undefined
    let cancelled = false
    let reconnectAttempt = 0

    async function connect() {
      try {
        setRealtimeConnected(false)
        const { ticket } = await api.realtimeTicket(organizationId, token)
        if (cancelled) return

        socket = new WebSocket(`${WS_URL}/ws/organizations/${organizationId}?ticket=${encodeURIComponent(ticket)}`)
        socket.onopen = () => {
          reconnectAttempt = 0
          setRealtimeConnected(true)
          if (keepAlive !== undefined) window.clearInterval(keepAlive)
          keepAlive = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25000)
        }
        socket.onmessage = () => { void loadOverview(organizationId); if (selectedIncident) void refreshSelectedIncident() }
        socket.onclose = () => {
          setRealtimeConnected(false)
          if (keepAlive !== undefined) window.clearInterval(keepAlive)
          if (!cancelled) {
            const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000)
            reconnectAttempt += 1
            reconnectTimer = window.setTimeout(() => { void connect() }, delay)
          }
        }
      } catch (err) {
        setRealtimeConnected(false)
        if (!cancelled) {
          const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000)
          reconnectAttempt += 1
          reconnectTimer = window.setTimeout(() => { void connect() }, delay)
          if (err instanceof ApiError && err.status === 401) onLogout()
        }
      }
    }

    void connect()
    return () => {
      cancelled = true
      setRealtimeConnected(false)
      if (keepAlive !== undefined) window.clearInterval(keepAlive)
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      socket?.close(1000, 'Aegis realtime view changed')
    }
  }, [organizationId, token, loadOverview, refreshSelectedIncident, selectedIncident?.id, onLogout])

  function navigate(next: View) { setView(next); setMobileNav(false); setError('') }

  async function createService(event: FormEvent) {
    event.preventDefault(); if (!organizationId) return
    setBusy('service')
    try { await api.createService(organizationId, { name: serviceName, description: serviceDescription }, token); setServiceName(''); setServiceDescription(''); setServiceModal(false); await loadOverview() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create service.') }
    finally { setBusy('') }
  }

  async function simulate(service: Service) {
    setBusy(`simulate-${service.id}`)
    try { await api.simulateOutage(organizationId, service.id, token); await loadOverview() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Simulation failed.') }
    finally { setBusy('') }
  }

  async function resolve(incident: Incident) {
    setBusy(`resolve-${incident.id}`)
    try { await api.resolveIncident(organizationId, incident.id, token); await loadOverview(); if (selectedIncident?.id === incident.id) await refreshSelectedIncident() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not resolve incident.') }
    finally { setBusy('') }
  }

  async function inspect(incident: Incident) {
    setBusy(`inspect-${incident.id}`)
    try { setSelectedIncident(await api.incident(organizationId, incident.id, token)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not load incident.') }
    finally { setBusy('') }
  }

  async function createDependency(source: string, target: string) {
    setBusy('dependency')
    try { await api.createDependency(organizationId, source, target, token); setDependencies(await api.dependencies(organizationId, token)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create dependency.') }
    finally { setBusy('') }
  }

  async function createApiKey(name: string) {
    setBusy('api-key')
    try { const created = await api.createApiKey(organizationId, name, token); setCreatedKey(created); setApiKeys(await api.apiKeys(organizationId, token)) }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create API key.') }
    finally { setBusy('') }
  }

  if (!membership || loading || !overview) return <div className="boot-screen"><div className="brand brand-large"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div><RefreshCw className="spin" /></div>

  const navigation: { id: View; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'command', label: 'Command center', icon: <Gauge /> },
    { id: 'incidents', label: 'Incidents', icon: <Siren />, count: activeIncidents.length || undefined },
    { id: 'services', label: 'Services', icon: <Server /> },
    { id: 'dependencies', label: 'Dependencies', icon: <Network /> },
    { id: 'analytics', label: 'Analytics', icon: <Activity /> },
    { id: 'integrations', label: 'Integrations', icon: <Boxes /> },
    { id: 'status', label: 'Status page', icon: <Radio /> },
    { id: 'settings', label: 'Settings', icon: <Settings /> },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand brand"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div>
      <nav><span className="nav-label">OPERATIONS</span>{navigation.slice(0, 4).map((item) => <button key={item.id} className={`nav-item nav-button ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span>{item.count && <em>{item.count}</em>}</button>)}<span className="nav-label second">PLATFORM</span>{navigation.slice(4).map((item) => <button key={item.id} className={`nav-item nav-button ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="live-indicator"><span /><div><b>{realtimeConnected ? 'Realtime connected' : 'Realtime reconnecting'}</b><small>Organization channel</small></div></div><button className="profile-button" onClick={onLogout}><span className="avatar">{user.full_name.split(' ').map((name) => name[0]).slice(0, 2).join('').toUpperCase()}</span><span><b>{user.full_name}</b><small>{membership.role}</small></span><LogOut size={15} /></button></div>
    </aside>

    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)}><Menu /></button><div className="workspace-select"><span>Workspace</span><b>{membership.organization.name}</b></div><div className="topbar-actions"><div className="search-box"><Search size={16} /><span>Search Aegis</span><kbd>⌘ K</kbd></div><button className="icon-btn"><Bell size={17} /></button><button className="primary" onClick={() => setServiceModal(true)}><Plus size={16} />Add service</button></div></header>
      <div className="content">
        <section className="page-heading"><div><div className="eyebrow"><CircleDot size={13} /> {viewMeta[view].eyebrow}</div><h1>{viewMeta[view].title}</h1><p>{viewMeta[view].description}</p></div><div className="heading-actions"><button className="secondary" onClick={() => loadOverview()}><RefreshCw size={15} />Refresh</button></div></section>
        <ErrorBanner message={error} dismiss={() => setError('')} />
        {view === 'command' && <CommandView overview={overview} busy={busy} simulate={simulate} inspect={inspect} resolve={resolve} addService={() => setServiceModal(true)} />}
        {view === 'incidents' && <section className="panel"><div className="panel-head"><div><h2>Incident history</h2><p>Active and resolved incidents, newest first</p></div><Siren size={17} /></div><IncidentTable incidents={overview.incidents} busy={busy} onInspect={inspect} onResolve={resolve} /></section>}
        {view === 'services' && <ServicesView services={overview.services} busy={busy} simulate={simulate} addService={() => setServiceModal(true)} />}
        {view === 'dependencies' && <DependenciesView services={overview.services} dependencies={dependencies} busy={busy} create={createDependency} />}
        {view === 'analytics' && <AnalyticsView data={analytics} />}
        {view === 'integrations' && <IntegrationsView apiKeys={apiKeys} createdKey={createdKey} role={membership.role} busy={busy} createKey={createApiKey} />}
        {view === 'status' && <StatusView data={publicStatus} />}
        {view === 'settings' && <SettingsView membership={membership} user={user} />}
      </div>
    </main>

    {serviceModal && <div className="modal-backdrop" onMouseDown={() => setServiceModal(false)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow"><Server size={13} /> SERVICE CATALOG</div><h2>Add production service</h2></div><button className="icon-btn" onClick={() => setServiceModal(false)}><X size={18} /></button></div><form onSubmit={createService}><label>Service name<input autoFocus required minLength={2} value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Payments API" /></label><label>Description<textarea value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} placeholder="Processes card payments and transaction routing." /></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setServiceModal(false)}>Cancel</button><button className="primary" disabled={busy === 'service'}>{busy === 'service' ? <RefreshCw className="spin" size={15} /> : <Plus size={15} />}Create service</button></div></form></div></div>}
    {selectedIncident && <IncidentDrawer incident={selectedIncident} organizationId={organizationId} token={token} onClose={() => setSelectedIncident(null)} onChanged={async () => { await refreshSelectedIncident(); await loadOverview() }} />}
  </div>
}

export default function AppV2() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [user, setUser] = useState<User | null>(null)
  const [validating, setValidating] = useState(Boolean(token))

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.me(token).then(setUser).catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null) }).finally(() => setValidating(false))
  }, [token])

  function authenticated(nextToken: string, nextUser: User) { localStorage.setItem(TOKEN_KEY, nextToken); setToken(nextToken); setUser(nextUser) }
  function logout() { localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null) }

  if (validating) return <div className="boot-screen"><div className="brand brand-large"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div><RefreshCw className="spin" /></div>
  if (!token || !user) return <AuthScreen onAuthenticated={authenticated} />
  return <Dashboard token={token} user={user} onLogout={logout} />
}
