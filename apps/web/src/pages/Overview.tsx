import { Plus, Radio, Server } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { sortActive } from '../console/Console'
import { DemoGuide } from '../demo/DemoGuide'
import { duration } from '../lib/format'
import { canEditCatalog } from '../lib/roles'
import { href } from '../lib/router'
import { StatusBadge } from '../ui/Badges'
import { Empty, PageHeader, Panel } from '../ui/Layout'
import { IncidentList } from './shared'

export function OverviewPage() {
  const { overview, membership, openDialog } = useConsole()
  const { demo } = useClient()
  const editable = canEditCatalog(membership.role)
  const active = sortActive(overview.incidents)
  const resolved = overview.incidents.filter((incident) => incident.status === 'resolved').slice(0, 5)
  const oldest = active.reduce<string | null>((min, incident) => (!min || incident.created_at < min ? incident.created_at : min), null)
  const impacted = overview.services.filter((service) => service.status !== 'operational')
  const healthy = overview.services.length - impacted.length

  return (
    <>
      <PageHeader
        title="Overview"
        description={active.length ? `${active.length} incident${active.length === 1 ? '' : 's'} in progress across ${membership.organization.name}.` : `Nothing is on fire at ${membership.organization.name}.`}
        actions={editable && overview.services.length > 0 && (
          <button type="button" className="button" onClick={() => openDialog('simulate')}><Radio size={15} />Simulate alert</button>
        )}
      />
      {demo && <DemoGuide />}

      <dl className="stats">
        <div className={overview.active_incidents ? 'stat stat-alert' : 'stat'}>
          <dt>Active incidents</dt>
          <dd>{overview.active_incidents}</dd>
          <span>{overview.sev1_incidents ? `${overview.sev1_incidents} at SEV1` : 'None at SEV1'}</span>
        </div>
        <div className="stat">
          <dt>Services impacted</dt>
          <dd>{impacted.length}<small>/{overview.services.length}</small></dd>
          <span>{impacted.length ? impacted.map((service) => service.name).slice(0, 2).join(', ') : 'All operational'}</span>
        </div>
        <div className="stat">
          <dt>Longest open</dt>
          <dd>{oldest ? duration(oldest) : '–'}</dd>
          <span>{oldest ? 'Oldest unresolved incident' : 'No open incidents'}</span>
        </div>
        <div className="stat">
          <dt>Resolved recently</dt>
          <dd>{resolved.length}</dd>
          <span>Of the latest {overview.incidents.length} incidents</span>
        </div>
      </dl>

      {overview.services.length === 0 ? (
        <Panel>
          <Empty
            icon={<Server size={20} />}
            title="Add the first service you run"
            action={editable && <button type="button" className="button primary" onClick={() => openDialog('service')}><Plus size={15} />Add service</button>}
          >
            Alerts, incidents, dependencies and your public status page are all organised around services.
          </Empty>
        </Panel>
      ) : (
        <div className="overview-grid">
          <div className="stack">
            <Panel title="In progress" description="Highest severity first" actions={<a className="link" href={href({ page: 'incidents' })}>All incidents</a>}>
              <IncidentList incidents={active} services={overview.services} empty={{ title: 'No active incidents', body: 'When an alert fires or someone declares an incident, it appears here.' }} />
            </Panel>
            {resolved.length > 0 && (
              <Panel title="Recently resolved">
                <IncidentList incidents={resolved} services={overview.services} />
              </Panel>
            )}
          </div>
          <Panel title="Service health" description={`${healthy} of ${overview.services.length} operational`} actions={<a className="link" href={href({ page: 'services' })}>Manage</a>}>
            <ul className="health-list">
              {[...overview.services].sort((a, b) => Number(a.status === 'operational') - Number(b.status === 'operational') || a.name.localeCompare(b.name)).map((service) => (
                <li key={service.id}>
                  <span className="health-name">{service.name}</span>
                  <StatusBadge status={service.status} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  )
}
