import { Plus, Radio, Server } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { sentence } from '../lib/format'
import { canEditCatalog, canRespond } from '../lib/roles'
import { href } from '../lib/router'
import type { Service, ServiceStatus } from '../types'
import { StatusBadge } from '../ui/Badges'
import { useAction, useResource } from '../ui/hooks'
import { Empty, PageHeader, Panel } from '../ui/Layout'

const statuses: ServiceStatus[] = ['operational', 'degraded', 'outage', 'maintenance']

export function ServicesPage() {
  const { client } = useClient()
  const { organizationId, token, revision, overview, membership, openDialog, refresh } = useConsole()
  const incidents = useResource(() => client.incidents(organizationId, token), `${organizationId}:${revision}`)
  const { pending, run } = useAction()
  const editable = canEditCatalog(membership.role)
  const responder = canRespond(membership.role)

  const openByService = new Map<string, string[]>()
  for (const incident of incidents.data ?? []) {
    if (incident.status === 'resolved' || !incident.service_id) continue
    openByService.set(incident.service_id, [...(openByService.get(incident.service_id) ?? []), incident.id])
  }

  async function changeStatus(service: Service, status: ServiceStatus) {
    if (status === service.status) return
    if (await run(service.id, () => client.updateServiceStatus(organizationId, service.id, status, token), `${service.name} set to ${status}`)) await refresh()
  }

  return (
    <>
      <PageHeader
        title="Services"
        description="The systems you operate. Status here drives the public status page."
        actions={editable && (
          <>
            {overview.services.length > 0 && <button type="button" className="button" onClick={() => openDialog('simulate')}><Radio size={15} />Simulate alert</button>}
            <button type="button" className="button primary" onClick={() => openDialog('service')}><Plus size={15} />Add service</button>
          </>
        )}
      />
      <Panel>
        {overview.services.length === 0 ? (
          <Empty icon={<Server size={20} />} title="No services yet"
            action={editable && <button type="button" className="button primary" onClick={() => openDialog('service')}><Plus size={15} />Add service</button>}>
            Add the APIs, workers and sites you run. Alerts are routed to a service by its slug.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Service</th><th scope="col">Alert routing slug</th><th scope="col">Open incidents</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {overview.services.map((service) => {
                  const open = openByService.get(service.id) ?? []
                  return (
                    <tr key={service.id}>
                      <th scope="row" data-label="Service">
                        <b>{service.name}</b>
                        {service.description && <small>{service.description}</small>}
                      </th>
                      <td data-label="Slug"><code>{service.slug}</code></td>
                      <td data-label="Open incidents">
                        {open.length === 0 ? <span className="muted-text">None</span>
                          : open.length === 1 ? <a className="link" href={href({ page: 'incident', id: open[0] })}>1 open</a>
                            : <a className="link" href={href({ page: 'incidents' })}>{open.length} open</a>}
                      </td>
                      <td data-label="Status">
                        {responder ? (
                          <label className={`status-select tone-${service.status}`}>
                            <span className="sr-only">Status of {service.name}</span>
                            <select value={service.status} disabled={pending === service.id} onChange={(e) => changeStatus(service, e.target.value as ServiceStatus)}>
                              {statuses.map((status) => (
                                <option key={status} value={status} disabled={status === 'operational' && open.length > 0}>
                                  {sentence(status)}{status === 'operational' && open.length > 0 ? ' (resolve incidents first)' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : <StatusBadge status={service.status} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
