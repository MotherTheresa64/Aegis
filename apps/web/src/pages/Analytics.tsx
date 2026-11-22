import { useClient } from '../client'
import { useConsole } from '../console/context'
import { useResource } from '../ui/hooks'
import { ErrorState, Loading, PageHeader, Panel } from '../ui/Layout'

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '–'
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`
}

export function AnalyticsPage() {
  const { client } = useClient()
  const { organizationId, token, revision } = useConsole()
  const { data, error, reload } = useResource(() => client.analytics(organizationId, token), `${organizationId}:${revision}`)

  const header = <PageHeader title="Analytics" description="Reliability over the last 30 days, computed on the server from incident records." />
  if (error) return <>{header}<ErrorState message={error} retry={reload} /></>
  if (!data) return <>{header}<Loading /></>

  const resolutionRate = data.incidents_30d ? Math.round((data.resolved_30d / data.incidents_30d) * 100) : null
  const sev1Share = data.incidents_30d ? Math.round((data.sev1_30d / data.incidents_30d) * 100) : null

  return (
    <>
      {header}
      <dl className="stats">
        <div className="stat"><dt>Incidents</dt><dd>{data.incidents_30d}</dd><span>Declared or opened by alerts</span></div>
        <div className="stat"><dt>Mean time to resolve</dt><dd>{formatMinutes(data.mean_time_to_resolve_minutes)}</dd><span>{data.resolved_30d ? `Across ${data.resolved_30d} resolved` : 'Nothing resolved yet'}</span></div>
        <div className={data.sev1_30d ? 'stat stat-alert' : 'stat'}><dt>SEV1 incidents</dt><dd>{data.sev1_30d}</dd><span>{sev1Share === null ? 'No incidents' : `${sev1Share}% of all incidents`}</span></div>
        <div className="stat"><dt>Resolved</dt><dd>{resolutionRate === null ? '–' : `${resolutionRate}%`}</dd><span>{data.resolved_30d} of {data.incidents_30d}</span></div>
      </dl>
      <div className="split">
        <Panel title="Right now">
          <dl className="details">
            <div><dt>Open incidents</dt><dd>{data.current_active}</dd></div>
            <div><dt>Services not operational</dt><dd>{data.current_impacted_services}</dd></div>
          </dl>
        </Panel>
        <Panel title="How these are calculated">
          <ul className="plain-list">
            <li>The window is the last 30 days of incident creation times.</li>
            <li>Time to resolve runs from when the incident opened to when it was marked resolved, using stored timestamps.</li>
            <li>Only incidents in this workspace are counted.</li>
          </ul>
        </Panel>
      </div>
    </>
  )
}
