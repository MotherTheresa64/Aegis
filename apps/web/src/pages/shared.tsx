import { CheckCircle2 } from 'lucide-react'

import { duration, incidentRef, timeAgo } from '../lib/format'
import { href } from '../lib/router'
import type { Incident, Service } from '../types'
import { SeverityBadge, StatusBadge } from '../ui/Badges'
import { Empty } from '../ui/Layout'

/** One markup for every width: a row grid on desktop that reflows into a card on phones. */
export function IncidentList({ incidents, services, empty }: { incidents: Incident[]; services: Service[]; empty?: { title: string; body: string } }) {
  if (!incidents.length) {
    return <Empty icon={<CheckCircle2 size={20} />} title={empty?.title ?? 'No incidents'}>{empty?.body}</Empty>
  }
  const names = new Map(services.map((service) => [service.id, service.name]))
  return (
    <ul className="incident-list">
      {incidents.map((incident) => (
        <li key={incident.id}>
          <a href={href({ page: 'incident', id: incident.id })} className={`incident-row ${incident.status === 'resolved' ? 'is-resolved' : ''}`}>
            <SeverityBadge severity={incident.severity} />
            <span className="incident-row-main">
              <b>{incident.title}</b>
              <span className="incident-row-meta">
                <span className="mono">{incidentRef(incident.id)}</span>
                {incident.service_id && <span>{names.get(incident.service_id) ?? 'Removed service'}</span>}
                {!incident.created_by_id && <span>Opened by alert</span>}
              </span>
            </span>
            <StatusBadge status={incident.status} />
            <span className="incident-row-time">
              {incident.status === 'resolved' && incident.resolved_at
                ? <>Resolved {timeAgo(incident.resolved_at)}<small>lasted {duration(incident.created_at, incident.resolved_at)}</small></>
                : <>Open {duration(incident.created_at)}<small>since {timeAgo(incident.created_at)}</small></>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
