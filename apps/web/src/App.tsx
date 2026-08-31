import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Boxes, CheckCircle2, ChevronRight, CircleDot,
  Clock3, Command, Cpu, Gauge, LogOut, Menu, Network, Plus, Radio, RefreshCw,
  Search, Server, Settings, Shield, ShieldCheck, Siren, X, Zap,
} from 'lucide-react'
import { api, ApiError, WS_URL } from './api'
import type { Incident, IncidentDetail, Membership, Overview, Service, User } from './types'

const TOKEN_KEY = 'aegis_token'

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
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

  return (
    <div className="auth-shell">
      <div className="auth-grid" />
      <section className="auth-story">
        <div className="brand brand-large"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div>
        <div className="eyebrow"><Radio size={14} /> INCIDENT OPERATIONS, UNIFIED</div>
        <h1>Control the moment<br /><span>systems fail.</span></h1>
        <p>A realtime operations layer for service health, alerts, incident response, customer communication, and recovery.</p>
        <div className="auth-features">
          <div><Zap /><span><b>Realtime response</b><small>Live incident state across every responder.</small></span></div>
          <div><Network /><span><b>Service intelligence</b><small>Understand blast radius and dependencies.</small></span></div>
          <div><ShieldCheck /><span><b>Operational control</b><small>Tenant-aware access and auditable actions.</small></span></div>
        </div>
      </section>
      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="auth-tabs">
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create workspace</button>
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
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
          <small className="auth-footnote">Built for operational clarity. Every tenant boundary is enforced server-side.</small>
        </div>
      </section>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill ${status}`}><span className="status-dot" />{titleCase(status)}</span>
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`severity ${severity}`}>{severity.toUpperCase()}</span>
}

function KpiCard({ icon, label, value, hint, tone = '' }: { icon: React.ReactNode; label: string; value: number; hint: string; tone?: string }) {
  return <div className={`kpi-card ${tone}`}><div className="kpi-top"><span className="kpi-icon">{icon}</span><span>{label}</span></div><strong>{value}</strong><small>{hint}</small></div>
}

function IncidentDrawer({ incident, organizationId, token, onClose, onChanged }: {
  incident: IncidentDetail; organizationId: string; token: string; onClose: () => void; onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const [posting, setPosting] = useState(false)

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setPosting(true)
    try {
      await api.addIncidentNote(organizationId, incident.id, note.trim(), token)
      setNote('')
      onChanged()
    } finally { setPosting(false) }
  }

  return <div className="drawer-backdrop" onMouseDown={onClose}>
    <aside className="incident-drawer" onMouseDown={(e) => e.stopPropagation()}>
      <div className="drawer-header">
        <div><div className="eyebrow"><Siren size={13} /> INCIDENT COMMAND</div><h2>{incident.title}</h2></div>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="incident-meta"><SeverityBadge severity={incident.severity} /><StatusPill status={incident.status} /><span><Clock3 size={14} />{timeAgo(incident.created_at)}</span></div>
      {incident.summary && <p className="incident-summary">{incident.summary}</p>}
      <div className="timeline-title"><span>Incident timeline</span><small>{incident.events.length} events</small></div>
      <div className="timeline">
        {incident.events.map((event, index) => <div className="timeline-event" key={event.id}>
          <div className="timeline-rail"><span className="timeline-node" />{index < incident.events.length - 1 && <span className="timeline-line" />}</div>
          <div><div className="timeline-event-head"><b>{titleCase(event.event_type.replaceAll('.', ' '))}</b><time>{new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{event.message}</p></div>
        </div>)}
      </div>
      {incident.status !== 'resolved' && <form className="note-form" onSubmit={addNote}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an incident update…" /><button className="primary" disabled={posting}>{posting ? <RefreshCw className="spin" size={15} /> : <Command size={15} />}Post update</button></form>}
    </aside>
  </div>
}

function Dashboard({ token, user, onLogout }: { token: string; user: User; onLogout: () => void }) {
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [organizationId, setOrganizationId] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serviceModal, setServiceModal] = useState(false)
  const [serviceName, setServiceName] = useState('')
  const [serviceDescription, setServiceDescription] = useState('')
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null)
  const [busy, setBusy] = useState('')
  const [mobileNav, setMobileNav] = useState(false)

  const membership = useMemo(() => memberships.find((item) => item.organization.id === organizationId), [memberships, organizationId])

  const loadOverview = useCallback(async (orgId = organizationId) => {
    if (!orgId) return
    try {
      const data = await api.overview(orgId, token)
      setOverview(data)
      setError('')
      if (selectedIncident) {
        const detail = await api.incident(orgId, selectedIncident.id, token)
        setSelectedIncident(detail)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load the operations dashboard.')
    } finally { setLoading(false) }
  }, [organizationId, selectedIncident?.id, token])

  useEffect(() => {
    api.memberships(token).then((items) => {
      setMemberships(items)
      if (items[0]) setOrganizationId(items[0].organization.id)
      else setLoading(false)
    }).catch(() => onLogout())
  }, [token])

  useEffect(() => { if (organizationId) void loadOverview(organizationId) }, [organizationId])

  useEffect(() => {
    if (!organizationId) return
    const socket = new WebSocket(`${WS_URL}/ws/organizations/${organizationId}?token=${encodeURIComponent(token)}`)
    socket.onmessage = () => void loadOverview(organizationId)
    const keepAlive = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 25000)
    return () => { window.clearInterval(keepAlive); socket.close() }
  }, [organizationId, token, loadOverview])

  async function createService(event: FormEvent) {
    event.preventDefault()
    if (!organizationId) return
    setBusy('service')
    try {
      await api.createService(organizationId, { name: serviceName, description: serviceDescription }, token)
      setServiceName(''); setServiceDescription(''); setServiceModal(false)
      await loadOverview()
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create service.') }
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
    try { await api.resolveIncident(organizationId, incident.id, token); await loadOverview() }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not resolve incident.') }
    finally { setBusy('') }
  }

  async function inspectIncident(incident: Incident) {
    setBusy(`inspect-${incident.id}`)
    try { setSelectedIncident(await api.incident(organizationId, incident.id, token)) }
    finally { setBusy('') }
  }

  const activeIncidents = overview?.incidents.filter((i) => i.status !== 'resolved') || []

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand brand"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div>
      <nav>
        <span className="nav-label">OPERATIONS</span>
        <a className="nav-item active"><Gauge /><span>Command center</span></a>
        <a className="nav-item"><Siren /><span>Incidents</span>{activeIncidents.length > 0 && <em>{activeIncidents.length}</em>}</a>
        <a className="nav-item"><Bell /><span>Alerts</span></a>
        <a className="nav-item"><Server /><span>Services</span></a>
        <a className="nav-item"><Network /><span>Dependencies</span></a>
        <span className="nav-label second">PLATFORM</span>
        <a className="nav-item"><Activity /><span>Analytics</span></a>
        <a className="nav-item"><Boxes /><span>Integrations</span></a>
        <a className="nav-item"><Settings /><span>Settings</span></a>
      </nav>
      <div className="sidebar-bottom">
        <div className="live-indicator"><span /><div><b>Realtime connected</b><small>Organization channel</small></div></div>
        <button className="profile-button" onClick={onLogout}><span className="avatar">{user.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}</span><span><b>{user.full_name}</b><small>{membership?.role || 'member'}</small></span><LogOut size={15} /></button>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)}><Menu /></button>
        <div className="workspace-select"><span>Workspace</span><b>{membership?.organization.name || 'Loading…'}</b></div>
        <div className="topbar-actions"><div className="search-box"><Search size={16} /><span>Search Aegis</span><kbd>⌘ K</kbd></div><button className="icon-btn"><Bell size={17} /><span className="notification-dot" /></button><button className="primary" onClick={() => setServiceModal(true)}><Plus size={16} />Add service</button></div>
      </header>

      <div className="content">
        <section className="page-heading"><div><div className="eyebrow"><CircleDot size={13} /> LIVE OPERATIONS</div><h1>Command center</h1><p>Realtime health and incident response across your production surface.</p></div><div className="heading-actions"><button className="secondary" onClick={() => loadOverview()}><RefreshCw size={15} />Refresh</button></div></section>

        {error && <div className="error-banner"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}

        {loading || !overview ? <div className="loading-state"><RefreshCw className="spin" /><span>Synchronizing operations data…</span></div> : <>
          <section className="kpi-grid">
            <KpiCard icon={<Server />} label="Monitored services" value={overview.services_total} hint={overview.services_total ? 'Production catalog' : 'Add your first service'} />
            <KpiCard icon={<Activity />} label="Active incidents" value={overview.active_incidents} hint={overview.active_incidents ? 'Requires attention' : 'No active incidents'} tone={overview.active_incidents ? 'warning' : ''} />
            <KpiCard icon={<Siren />} label="SEV-1 incidents" value={overview.sev1_incidents} hint={overview.sev1_incidents ? 'Immediate response' : 'No critical incidents'} tone={overview.sev1_incidents ? 'critical' : ''} />
            <KpiCard icon={<ShieldCheck />} label="Impacted services" value={overview.services_impacted} hint={overview.services_impacted ? 'Customer impact possible' : 'All systems nominal'} tone={overview.services_impacted ? 'critical' : 'healthy'} />
          </section>

          {overview.services.length === 0 ? <section className="empty-onboarding">
            <div className="empty-graphic"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><Shield /></div>
            <div><div className="eyebrow"><Cpu size={13} /> INITIALIZE AEGIS</div><h2>Connect your first production service.</h2><p>Services become the center of health monitoring, alert routing, incidents, status communication, and dependency intelligence.</p><button className="primary" onClick={() => setServiceModal(true)}><Plus size={16} />Create first service</button></div>
          </section> : <>
            <section className="operations-grid">
              <div className="panel services-panel">
                <div className="panel-head"><div><h2>Service health</h2><p>Current production state</p></div><span className="panel-meta"><Radio size={13} /> LIVE</span></div>
                <div className="service-list">
                  {overview.services.map((service) => <div className="service-row" key={service.id}>
                    <div className="service-icon"><Server size={18} /></div>
                    <div className="service-name"><b>{service.name}</b><small>{service.description || service.slug}</small></div>
                    <StatusPill status={service.status} />
                    <button className="simulate-button" disabled={busy === `simulate-${service.id}`} onClick={() => simulate(service)} title="Trigger a synthetic SEV-1 alert"><Zap size={14} />{busy === `simulate-${service.id}` ? 'Triggering…' : 'Simulate outage'}</button>
                  </div>)}
                </div>
              </div>

              <div className="panel signal-panel">
                <div className="panel-head"><div><h2>Operational signal</h2><p>Environment health score</p></div><Activity size={17} /></div>
                <div className={`health-ring ${overview.services_impacted ? 'unhealthy' : ''}`}><div><strong>{overview.services_total ? Math.max(0, Math.round(((overview.services_total - overview.services_impacted) / overview.services_total) * 100)) : 100}</strong><span>%</span><small>HEALTH</small></div></div>
                <div className="signal-stats"><span><i className="healthy-dot" />Operational<b>{overview.services_total - overview.services_impacted}</b></span><span><i className="impact-dot" />Impacted<b>{overview.services_impacted}</b></span></div>
              </div>
            </section>

            <section className="panel incident-panel">
              <div className="panel-head"><div><h2>Incident stream</h2><p>Latest operational events and active response</p></div><span className="panel-meta">{overview.incidents.length} RECENT</span></div>
              {overview.incidents.length === 0 ? <div className="empty-table"><CheckCircle2 /><b>No incidents recorded</b><span>Trigger a simulation from a service to exercise the response pipeline.</span></div> : <div className="incident-table-wrap"><table className="incident-table"><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Started</th><th>Response</th></tr></thead><tbody>
                {overview.incidents.map((incident) => <tr key={incident.id} onClick={() => inspectIncident(incident)}>
                  <td><div className="incident-title"><span className={`incident-beacon ${incident.status}`} /><div><b>{incident.title}</b><small>INC-{incident.id.slice(0, 6).toUpperCase()}</small></div></div></td>
                  <td><SeverityBadge severity={incident.severity} /></td><td><StatusPill status={incident.status} /></td><td>{timeAgo(incident.created_at)}</td>
                  <td>{incident.status === 'resolved' ? <span className="resolved-text"><CheckCircle2 size={14} />Closed</span> : <button className="resolve-button" disabled={busy === `resolve-${incident.id}`} onClick={(e) => { e.stopPropagation(); void resolve(incident) }}><CheckCircle2 size={14} />Resolve</button>}<ChevronRight className="row-chevron" size={16} /></td>
                </tr>)}
              </tbody></table></div>}
            </section>
          </>}
        </>}
      </div>
    </main>

    {serviceModal && <div className="modal-backdrop" onMouseDown={() => setServiceModal(false)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow"><Server size={13} /> SERVICE CATALOG</div><h2>Add production service</h2></div><button className="icon-btn" onClick={() => setServiceModal(false)}><X size={18} /></button></div><form onSubmit={createService}><label>Service name<input autoFocus required minLength={2} value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Payments API" /></label><label>Description<textarea value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} placeholder="Processes card payments and transaction routing." /></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setServiceModal(false)}>Cancel</button><button className="primary" disabled={busy === 'service'}>{busy === 'service' ? <RefreshCw className="spin" size={15} /> : <Plus size={15} />}Create service</button></div></form></div></div>}
    {selectedIncident && <IncidentDrawer incident={selectedIncident} organizationId={organizationId} token={token} onClose={() => setSelectedIncident(null)} onChanged={() => loadOverview()} />}
  </div>
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [user, setUser] = useState<User | null>(null)
  const [validating, setValidating] = useState(Boolean(token))

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.me(token).then(setUser).catch(() => {
      localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null)
    }).finally(() => setValidating(false))
  }, [token])

  function authenticated(nextToken: string, nextUser: User) {
    localStorage.setItem(TOKEN_KEY, nextToken); setToken(nextToken); setUser(nextUser)
  }
  function logout() { localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null) }

  if (validating) return <div className="boot-screen"><div className="brand brand-large"><span className="brand-mark"><Shield /></span><span>AEGIS</span></div><RefreshCw className="spin" /></div>
  if (!token || !user) return <AuthScreen onAuthenticated={authenticated} />
  return <Dashboard token={token} user={user} onLogout={logout} />
}
