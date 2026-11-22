import { useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowRight, Waypoints, X } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { servicesAtRisk } from '../lib/graph'
import { canEditCatalog } from '../lib/roles'
import type { Dependency } from '../types'
import { StatusBadge } from '../ui/Badges'
import { useFeedback } from '../ui/Feedback'
import { useAction, useResource } from '../ui/hooks'
import { Empty, ErrorState, Loading, PageHeader, Panel, Spinner } from '../ui/Layout'

export function DependenciesPage() {
  const { client } = useClient()
  const { organizationId, token, revision, overview, membership } = useConsole()
  const { confirm } = useFeedback()
  const edges = useResource(() => client.dependencies(organizationId, token), `${organizationId}:${revision}`)
  const { pending, run } = useAction()
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const editable = canEditCatalog(membership.role)
  const byId = new Map(overview.services.map((service) => [service.id, service]))
  const name = (id: string) => byId.get(id)?.name ?? 'Removed service'

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!await run('create', () => client.createDependency(organizationId, source, target, token), `${name(source)} now depends on ${name(target)}`)) return
    setSource(''); setTarget('')
    await edges.reload()
  }

  async function remove(edge: Dependency) {
    const ok = await confirm({
      title: 'Remove dependency?',
      body: `${name(edge.source_service_id)} will no longer be flagged when ${name(edge.target_service_id)} is impacted.`,
      confirmLabel: 'Remove dependency',
      destructive: true,
    })
    if (ok && await run(edge.id, () => client.deleteDependency(organizationId, edge.id, token).then(() => true), 'Dependency removed')) await edges.reload()
  }

  const dependencies = edges.data ?? []
  const atRisk = servicesAtRisk(overview.services, dependencies)

  return (
    <>
      <PageHeader title="Dependencies" description="Declare what each service relies on, so an outage shows everything it puts at risk." />
      {atRisk.size > 0 && (
        <div className="callout callout-warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <b>{atRisk.size} service{atRisk.size === 1 ? '' : 's'} at risk downstream</b>
            <p>{[...atRisk.entries()].map(([id, causes]) => `${name(id)} (via ${causes.map(name).join(', ')})`).join('; ')}</p>
          </div>
        </div>
      )}
      <div className="split">
        <Panel title="Service map" description="Each service and the services it depends on">
          {edges.error ? <ErrorState message={edges.error} retry={edges.reload} /> : !edges.data ? <Loading /> : overview.services.length < 2 ? (
            <Empty icon={<Waypoints size={20} />} title="Add at least two services">Dependencies connect one service to another.</Empty>
          ) : (
            <ul className="dep-map">
              {overview.services.map((service) => {
                const upstream = dependencies.filter((edge) => edge.source_service_id === service.id)
                const risk = atRisk.get(service.id)
                return (
                  <li key={service.id} className={risk ? 'at-risk' : ''}>
                    <div className="dep-service">
                      <b>{service.name}</b>
                      <StatusBadge status={service.status} />
                      {risk && <span className="risk-tag">At risk</span>}
                    </div>
                    {upstream.length === 0 ? <span className="muted-text dep-none">No declared dependencies</span> : (
                      <ul className="dep-edges">
                        {upstream.map((edge) => {
                          const targetService = byId.get(edge.target_service_id)
                          return (
                            <li key={edge.id} className={targetService && targetService.status !== 'operational' && targetService.status !== 'maintenance' ? 'edge-impacted' : ''}>
                              <ArrowRight size={13} aria-hidden="true" />
                              <span>{name(edge.target_service_id)}</span>
                              {editable && (
                                <button type="button" className="icon-button" aria-label={`Remove: ${service.name} depends on ${name(edge.target_service_id)}`} disabled={pending === edge.id} onClick={() => remove(edge)}>
                                  {pending === edge.id ? <Spinner /> : <X size={13} />}
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        {editable && overview.services.length >= 2 && (
          <Panel title="Add dependency" className="sticky-panel">
            <form className="form" onSubmit={create}>
              <label className="field">
                <span>Service</span>
                <select required value={source} onChange={(e) => { setSource(e.target.value); if (e.target.value === target) setTarget('') }}>
                  <option value="">Choose a service</option>
                  {overview.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Depends on</span>
                <select required value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose what it relies on</option>
                  {overview.services.filter((service) => service.id !== source).map((service) => (
                    <option key={service.id} value={service.id} disabled={dependencies.some((edge) => edge.source_service_id === source && edge.target_service_id === service.id)}>{service.name}</option>
                  ))}
                </select>
              </label>
              <p className="hint">When the second service is degraded or down, the first is flagged as at risk.</p>
              <button className="button primary" disabled={pending === 'create' || !source || !target}>{pending === 'create' && <Spinner />}Add dependency</button>
            </form>
          </Panel>
        )}
      </div>
    </>
  )
}
