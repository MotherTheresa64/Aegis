import { useState, type FormEvent } from 'react'

import { useClient } from '../client'
import { navigate } from '../lib/router'
import type { Severity } from '../types'
import { severityOptions } from '../ui/Badges'
import { Dialog } from '../ui/Dialog'
import { useAction } from '../ui/hooks'
import { Spinner } from '../ui/Layout'
import { useConsole, type ConsoleDialog } from './context'

export function ConsoleDialogs({ open, onClose }: { open: ConsoleDialog | null; onClose: () => void }) {
  return (
    <>
      <DeclareIncidentDialog open={open === 'incident'} onClose={onClose} />
      <AddServiceDialog open={open === 'service'} onClose={onClose} />
      <SimulateAlertDialog open={open === 'simulate'} onClose={onClose} />
    </>
  )
}

function DeclareIncidentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client } = useClient()
  const { organizationId, token, overview, refresh } = useConsole()
  const { pending, run } = useAction()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState<Severity>('sev2')
  const [serviceId, setServiceId] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const created = await run('declare', () => client.createIncident(organizationId, {
      title: title.trim(), summary: summary.trim(), severity, service_id: serviceId || null,
    }, token), 'Incident declared')
    if (!created) return
    setTitle(''); setSummary(''); setSeverity('sev2'); setServiceId('')
    onClose()
    await refresh()
    navigate({ page: 'incident', id: created.id })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Declare incident" description="You become incident commander. Responders see it immediately.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>What’s happening?</span>
          <input required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkout requests failing in eu-west" autoFocus />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {severityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Affected service</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Not service-specific</option>
              {overview.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Customer impact <small>Optional</small></span>
          <textarea rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Who is affected and how?" />
        </label>
        {serviceId && <p className="hint">The service is marked degraded until every incident affecting it is resolved.</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button className="button danger-solid" disabled={pending !== null}>{pending && <Spinner />}Declare incident</button>
        </div>
      </form>
    </Dialog>
  )
}

function AddServiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client } = useClient()
  const { organizationId, token, refresh } = useConsole()
  const { pending, run } = useAction()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const created = await run('service', () => client.createService(organizationId, { name: name.trim(), description: description.trim() }, token), `${name.trim()} added`)
    if (created === undefined) return
    setName(''); setDescription('')
    onClose()
    await refresh()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add service" description="Services own alerts, incidents, dependencies and a row on your status page.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments API" autoFocus />
        </label>
        <label className="field">
          <span>Description <small>Shown on the public status page</small></span>
          <textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Card authorization and settlement" />
        </label>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={pending !== null}>{pending && <Spinner />}Add service</button>
        </div>
      </form>
    </Dialog>
  )
}

function SimulateAlertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client } = useClient()
  const { organizationId, token, overview, refresh } = useConsole()
  const { pending, run } = useAction()
  const [serviceId, setServiceId] = useState('')
  const [severity, setSeverity] = useState<Severity>('sev1')
  const [title, setTitle] = useState('Error rate above 5% for 5 minutes')
  const selected = serviceId || overview.services[0]?.id || ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    const created = await run('simulate', () => client.simulateAlert(organizationId, { service_id: selected, severity, title: title.trim() }, token), 'Alert received – incident opened')
    if (!created) return
    onClose()
    await refresh()
    navigate({ page: 'incident', id: created.id })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Simulate a monitoring alert" description="Runs the same path as an alert from your monitoring tool: the service goes into outage and an incident opens automatically.">
      {overview.services.length === 0 ? (
        <p className="dialog-text">Add a service first – alerts are always routed to a service.</p>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="field-row">
            <label className="field">
              <span>Service</span>
              <select value={selected} onChange={(e) => setServiceId(e.target.value)}>
                {overview.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {severityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Alert title</span>
            <input required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>Cancel</button>
            <button className="button primary" disabled={pending !== null}>{pending && <Spinner />}Send alert</button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
