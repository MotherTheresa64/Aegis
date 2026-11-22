import { useMemo, useState } from 'react'
import { Search, Siren } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { canRespond } from '../lib/roles'
import type { Severity } from '../types'
import { severityOptions } from '../ui/Badges'
import { useResource } from '../ui/hooks'
import { ErrorState, Loading, PageHeader, Panel } from '../ui/Layout'
import { IncidentList } from './shared'

type Scope = 'active' | 'resolved' | 'all'
const scopes: { value: Scope; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

export function IncidentsPage() {
  const { client } = useClient()
  const { organizationId, token, revision, overview, membership, openDialog } = useConsole()
  const { data, error, reload } = useResource(() => client.incidents(organizationId, token), `${organizationId}:${revision}`)
  const [scope, setScope] = useState<Scope>('active')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data ?? []).filter((incident) =>
      (scope === 'all' || (scope === 'active') === (incident.status !== 'resolved'))
      && (!severity || incident.severity === severity)
      && (!needle || `${incident.title} ${incident.summary}`.toLowerCase().includes(needle)))
  }, [data, scope, severity, query])

  const counts = useMemo(() => ({
    active: (data ?? []).filter((incident) => incident.status !== 'resolved').length,
    resolved: (data ?? []).filter((incident) => incident.status === 'resolved').length,
    all: data?.length ?? 0,
  }), [data])

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Every incident, from first alert to postmortem."
        actions={canRespond(membership.role) && <button type="button" className="button danger-solid" onClick={() => openDialog('incident')}><Siren size={15} />Declare incident</button>}
      />
      <Panel>
        <div className="toolbar">
          <div className="segmented" role="radiogroup" aria-label="Show incidents">
            {scopes.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={scope === item.value} onClick={() => setScope(item.value)}>
                {item.label}<span className="count">{counts[item.value]}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search incidents</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or summary" />
          </label>
          <label className="compact-select">
            <span className="sr-only">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | '')}>
              <option value="">Any severity</option>
              {severityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {error ? <ErrorState message={error} retry={reload} /> : !data ? <Loading /> : (
          <IncidentList
            incidents={filtered}
            services={overview.services}
            empty={query || severity
              ? { title: 'No incidents match these filters', body: 'Clear the search or severity filter to see more.' }
              : scope === 'active'
                ? { title: 'No active incidents', body: 'Everything is resolved. New alerts and declared incidents show up here.' }
                : { title: 'No incidents yet', body: 'Declare one or simulate an alert to walk through the response flow.' }}
          />
        )}
        {data && data.length >= 100 && <p className="hint">Showing the 100 most recent incidents.</p>}
      </Panel>
    </>
  )
}
