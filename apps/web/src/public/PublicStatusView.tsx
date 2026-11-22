import { useEffect, useState, type ReactElement } from 'react'
import { AlertTriangle, CheckCircle2, Wrench, XCircle } from 'lucide-react'

import { api } from '../api'
import { dateTime, timeAgo } from '../lib/format'
import { applyTheme } from '../lib/theme'
import type { PublicStatus, ServiceStatus } from '../types'
import { StatusBadge } from '../ui/Badges'
import { errorMessage } from '../ui/hooks'
import { Loading } from '../ui/Layout'

const headline: Record<ServiceStatus, { text: string; icon: ReactElement }> = {
  operational: { text: 'All systems operational', icon: <CheckCircle2 size={22} /> },
  degraded: { text: 'Some systems are degraded', icon: <AlertTriangle size={22} /> },
  outage: { text: 'Major outage in progress', icon: <XCircle size={22} /> },
  maintenance: { text: 'Scheduled maintenance in progress', icon: <Wrench size={22} /> },
}

const incidentPhase = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' }

export function PublicStatusView({ data }: { data: PublicStatus }) {
  const names = new Map(data.services.map((service) => [service.id, service.name]))
  return (
    <article className="public-status">
      <header className="public-status-head">
        <h2>{data.organization_name}</h2>
        <span>Status</span>
      </header>
      <div className={`public-banner tone-${data.overall_status}`}>
        {headline[data.overall_status].icon}
        <b>{headline[data.overall_status].text}</b>
      </div>
      {data.active_incidents.length > 0 && (
        <section className="public-section">
          <h3>Current incidents</h3>
          <ul className="public-incidents">
            {data.active_incidents.map((incident) => (
              <li key={incident.id}>
                <b>{incident.title}</b>
                <span>{incidentPhase[incident.status]}{incident.service_id && names.get(incident.service_id) ? `, affecting ${names.get(incident.service_id)}` : ''}. Started {timeAgo(incident.created_at)}.</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="public-section">
        <h3>Services</h3>
        {data.services.length === 0 ? <p className="muted-text">No services are published yet.</p> : (
          <ul className="public-services">
            {data.services.map((service) => (
              <li key={service.id}>
                <span><b>{service.name}</b>{service.description && <small>{service.description}</small>}</span>
                <StatusBadge status={service.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="public-foot">Updated {dateTime(data.generated_at)}</footer>
    </article>
  )
}

export function PublicStatusPage({ slug }: { slug: string }) {
  const [data, setData] = useState<PublicStatus | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    applyTheme()
    let cancelled = false
    const load = () => api.publicStatus(slug)
      .then((result) => { if (!cancelled) { setData(result); setError('') } })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)) })
    void load()
    const timer = window.setInterval(load, 60000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [slug])

  useEffect(() => {
    if (data) document.title = `${data.organization_name} status`
  }, [data])

  return (
    <div className="public-page">
      <main>
        {error && !data ? (
          <div className="public-status"><div className="public-banner tone-degraded"><AlertTriangle size={22} /><b>{error === 'Status page not found' ? 'There’s no status page at this address.' : error}</b></div></div>
        ) : data ? <PublicStatusView data={data} /> : <Loading label="Loading status…" />}
        <p className="public-powered">Powered by Aegis</p>
      </main>
    </div>
  )
}
