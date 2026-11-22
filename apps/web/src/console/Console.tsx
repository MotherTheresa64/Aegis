import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Globe, LayoutDashboard, LineChart, LogOut, Menu, Monitor, Moon, Plug, Server, ShieldHalf, Siren, Sun, Users, Waypoints,
} from 'lucide-react'

import { ApiError } from '../api'
import { useClient } from '../client'
import { duration, initials } from '../lib/format'
import { canRespond } from '../lib/roles'
import { href, useRoute, type Route } from '../lib/router'
import { useTheme, type ThemePreference } from '../lib/theme'
import type { Incident, Membership, Overview, User } from '../types'
import { SeverityBadge } from '../ui/Badges'
import { Dialog } from '../ui/Dialog'
import { errorMessage } from '../ui/hooks'
import { ErrorState, Loading } from '../ui/Layout'
import { AnalyticsPage } from '../pages/Analytics'
import { DependenciesPage } from '../pages/Dependencies'
import { IncidentPage } from '../pages/Incident'
import { IncidentsPage } from '../pages/Incidents'
import { IntegrationsPage } from '../pages/Integrations'
import { OverviewPage } from '../pages/Overview'
import { ServicesPage } from '../pages/Services'
import { StatusPreviewPage } from '../pages/StatusPreview'
import { TeamPage } from '../pages/Team'
import { ConsoleContext, type ConsoleDialog, type ConsoleValue } from './context'
import { ConsoleDialogs } from './Dialogs'
import { useRealtime, type RealtimeState } from './useRealtime'

const ORG_KEY = 'aegis-organization'

type NavPage = Exclude<Route['page'], 'incident'>
const navGroups: { label: string; items: { page: NavPage; label: string; icon: ReactNode }[] }[] = [
  {
    label: 'Operate',
    items: [
      { page: 'overview', label: 'Overview', icon: <LayoutDashboard size={17} /> },
      { page: 'incidents', label: 'Incidents', icon: <Siren size={17} /> },
      { page: 'services', label: 'Services', icon: <Server size={17} /> },
      { page: 'dependencies', label: 'Dependencies', icon: <Waypoints size={17} /> },
    ],
  },
  {
    label: 'Improve',
    items: [{ page: 'analytics', label: 'Analytics', icon: <LineChart size={17} /> }],
  },
  {
    label: 'Configure',
    items: [
      { page: 'integrations', label: 'Integrations', icon: <Plug size={17} /> },
      { page: 'status', label: 'Status page', icon: <Globe size={17} /> },
      { page: 'team', label: 'Team & audit', icon: <Users size={17} /> },
    ],
  },
]
const mobilePrimary: NavPage[] = ['overview', 'incidents', 'services']

const severityRank = { sev1: 0, sev2: 1, sev3: 2, sev4: 3 }
export function sortActive(incidents: Incident[]): Incident[] {
  return incidents
    .filter((incident) => incident.status !== 'resolved')
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.created_at.localeCompare(a.created_at))
}

export function Console({ token, user, onLogout: logoutProp, banner }: { token: string; user: User; onLogout: () => void; banner?: ReactNode }) {
  const { client, demo } = useClient()
  // Callers pass inline handlers; keep loaders stable so they don't refetch on every render.
  const logoutRef = useRef(logoutProp)
  logoutRef.current = logoutProp
  const onLogout = useCallback(() => logoutRef.current(), [])
  const route = useRoute()
  const [memberships, setMemberships] = useState<Membership[] | null>(null)
  const [organizationId, setOrganizationId] = useState(() => {
    try { return localStorage.getItem(ORG_KEY) ?? '' } catch { return '' }
  })
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [dialog, setDialog] = useState<ConsoleDialog | null>(null)

  const loadMemberships = useCallback(async () => {
    try {
      const items = await client.memberships(token)
      if (!items.length) return onLogout()
      setMemberships(items)
      setOrganizationId((current) => (items.some((item) => item.organization.id === current) ? current : items[0].organization.id))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout()
      setLoadError(errorMessage(err))
    }
  }, [client, token, onLogout])

  const refresh = useCallback(async () => {
    if (!organizationId) return
    try {
      setOverview(await client.overview(organizationId, token))
      setRevision((value) => value + 1)
      setLoadError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout()
      if (err instanceof ApiError && err.status === 403) return void loadMemberships()
      setLoadError(errorMessage(err))
    }
  }, [client, organizationId, token, onLogout, loadMemberships])

  useEffect(() => { void loadMemberships() }, [loadMemberships])
  useEffect(() => {
    if (!organizationId) return
    try { localStorage.setItem(ORG_KEY, organizationId) } catch { /* Selection lasts for this session. */ }
    setOverview(null)
    void refresh()
  }, [organizationId, refresh])

  const realtime = useRealtime({
    client, enabled: !demo, organizationId, token,
    onEvent: () => void refresh(),
    onUnauthorized: onLogout,
    onForbidden: () => void loadMemberships(),
  })

  const membership = memberships?.find((item) => item.organization.id === organizationId)
  const value = useMemo<ConsoleValue | null>(() => (membership && overview ? {
    user, token, membership, organizationId, overview, revision, refresh, openDialog: setDialog,
  } : null), [user, token, membership, organizationId, overview, revision, refresh])

  if (!value) {
    return (
      <div className="boot">
        <Brand />
        {loadError ? <ErrorState message={loadError} retry={() => { setLoadError(''); void loadMemberships(); void refresh() }} /> : <Loading label="Opening workspace…" />}
      </div>
    )
  }

  return (
    <ConsoleContext.Provider value={value}>
      <div className="shell">
        <Sidebar route={route} memberships={memberships!} onSwitch={setOrganizationId} realtime={realtime} onLogout={onLogout} />
        <div className="shell-main">
          {banner}
          <MobileBar route={route} memberships={memberships!} onSwitch={setOrganizationId} realtime={realtime} onLogout={onLogout} />
          <IncidentStrip route={route} />
          <main className="content" id="main">
            {loadError && <div className="inline-alert" role="alert">{loadError} <button type="button" className="link" onClick={() => void refresh()}>Retry</button></div>}
            <Page route={route} />
          </main>
        </div>
        <ConsoleDialogs open={dialog} onClose={() => setDialog(null)} />
      </div>
    </ConsoleContext.Provider>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'incidents': return <IncidentsPage />
    case 'incident': return <IncidentPage key={route.id} id={route.id} />
    case 'services': return <ServicesPage />
    case 'dependencies': return <DependenciesPage />
    case 'analytics': return <AnalyticsPage />
    case 'integrations': return <IntegrationsPage />
    case 'status': return <StatusPreviewPage />
    case 'team': return <TeamPage />
    default: return <OverviewPage />
  }
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true"><ShieldHalf size={18} /></span>
      <span className="brand-name">Aegis</span>
    </span>
  )
}

function useActiveIncidents() {
  const { overview } = useConsoleOrNull() ?? {}
  return overview ? sortActive(overview.incidents) : []
}

function useConsoleOrNull() {
  return useContext(ConsoleContext)
}

interface ChromeProps {
  route: Route
  memberships: Membership[]
  onSwitch: (id: string) => void
  realtime: RealtimeState
  onLogout: () => void
}

function isCurrent(route: Route, page: NavPage) {
  return route.page === page || (page === 'incidents' && route.page === 'incident')
}

function Sidebar({ route, memberships, onSwitch, realtime, onLogout }: ChromeProps) {
  const active = useActiveIncidents()
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-top">
        <Brand />
        <WorkspaceSwitcher memberships={memberships} onSwitch={onSwitch} />
      </div>
      <QuickActions />
      <nav className="nav">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <a key={item.page} href={href({ page: item.page } as Route)} className="nav-link" aria-current={isCurrent(route, item.page) ? 'page' : undefined}>
                {item.icon}
                <span>{item.label}</span>
                {item.page === 'incidents' && active.length > 0 && <span className="nav-count" aria-label={`${active.length} active`}>{active.length}</span>}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <RealtimeIndicator state={realtime} />
        <ThemeSwitch />
        <UserCard onLogout={onLogout} />
      </div>
    </aside>
  )
}

function QuickActions() {
  const { membership, openDialog } = useConsoleOrNull()!
  if (!canRespond(membership.role)) return null
  return (
    <button type="button" className="button danger-solid sidebar-declare" onClick={() => openDialog('incident')}>
      <Siren size={16} />Declare incident
    </button>
  )
}

function WorkspaceSwitcher({ memberships, onSwitch }: { memberships: Membership[]; onSwitch: (id: string) => void }) {
  const { membership } = useConsoleOrNull()!
  if (memberships.length < 2) {
    return <div className="workspace"><span className="workspace-name">{membership.organization.name}</span><span className="workspace-role">{membership.role}</span></div>
  }
  return (
    <label className="workspace">
      <span className="sr-only">Workspace</span>
      <select value={membership.organization.id} onChange={(e) => onSwitch(e.target.value)}>
        {memberships.map((item) => <option key={item.organization.id} value={item.organization.id}>{item.organization.name}</option>)}
      </select>
    </label>
  )
}

const realtimeCopy: Record<RealtimeState, string> = {
  live: 'Live updates on',
  connecting: 'Connecting live updates…',
  offline: 'Live updates paused – retrying',
  demo: 'Demo data – updates are local',
}

function RealtimeIndicator({ state }: { state: RealtimeState }) {
  return <div className={`realtime realtime-${state}`} role="status"><span className="realtime-dot" aria-hidden="true" />{realtimeCopy[state]}</div>
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme()
  const options: { value: ThemePreference; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={14} /> },
    { value: 'system', label: 'System', icon: <Monitor size={14} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
  ]
  return (
    <div className="segmented theme-switch" role="radiogroup" aria-label="Color theme">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={theme === option.value} title={option.label} onClick={() => setTheme(option.value)}>
          {option.icon}<span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { user, membership } = useConsoleOrNull()!
  return (
    <div className="user-card">
      <span className="avatar" aria-hidden="true">{initials(user.full_name)}</span>
      <span className="user-meta"><b>{user.full_name}</b><small>{user.email}</small></span>
      <button type="button" className="icon-button" onClick={onLogout} aria-label="Sign out" title={`Sign out (${membership.role})`}><LogOut size={16} /></button>
    </div>
  )
}

function MobileBar({ route, memberships, onSwitch, realtime, onLogout }: ChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const active = useActiveIncidents()
  const { membership, openDialog } = useConsoleOrNull()!
  useEffect(() => setMenuOpen(false), [route])
  return (
    <>
      <header className="mobile-bar">
        <Brand />
        <span className="mobile-workspace">{membership.organization.name}</span>
        <button type="button" className="icon-button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
      </header>
      <nav className="tabbar" aria-label="Primary">
        {navGroups[0].items.filter((item) => mobilePrimary.includes(item.page)).map((item) => (
          <a key={item.page} href={href({ page: item.page } as Route)} aria-current={isCurrent(route, item.page) ? 'page' : undefined}>
            {item.icon}<span>{item.label}</span>
            {item.page === 'incidents' && active.length > 0 && <span className="nav-count">{active.length}</span>}
          </a>
        ))}
        {canRespond(membership.role) && (
          <button type="button" className="tabbar-declare" onClick={() => openDialog('incident')}><Siren size={17} /><span>Declare</span></button>
        )}
        <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}><Menu size={17} /><span>More</span></button>
      </nav>
      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" size="sm">
        <div className="sheet-menu">
          <WorkspaceSwitcher memberships={memberships} onSwitch={onSwitch} />
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <a key={item.page} href={href({ page: item.page } as Route)} className="nav-link" aria-current={isCurrent(route, item.page) ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
                  {item.icon}<span>{item.label}</span>
                </a>
              ))}
            </div>
          ))}
          <RealtimeIndicator state={realtime} />
          <ThemeSwitch />
          <UserCard onLogout={onLogout} />
        </div>
      </Dialog>
    </>
  )
}

/** The one loud element: what's on fire right now, visible from every page. */
function IncidentStrip({ route }: { route: Route }) {
  const viewing = route.page === 'incident' ? route.id : null
  const active = useActiveIncidents().filter((incident) => incident.id !== viewing)
  const { overview } = useConsoleOrNull()!
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const top = active[0]
  if (!top) return null
  const service = overview.services.find((item) => item.id === top.service_id)
  return (
    <div className={`strip strip-${top.severity}`} role="region" aria-label="Active incidents">
      <SeverityBadge severity={top.severity} />
      <a className="strip-main" href={href({ page: 'incident', id: top.id })}>
        <b>{top.title}</b>
        <span>{top.status === 'investigating' ? 'Investigating' : top.status === 'identified' ? 'Cause identified' : 'Monitoring fix'}{service ? ` on ${service.name}` : ''} for {duration(top.created_at)}</span>
      </a>
      {active.length > 1 && <a className="strip-more" href={href({ page: 'incidents' })}>+{active.length - 1} more active</a>}
    </div>
  )
}

