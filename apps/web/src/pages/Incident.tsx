import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, Check, CircleDashed, CopyPlus, FileText, ListChecks, Loader, MessageSquare, Radio, Siren, Workflow,
} from 'lucide-react'

import { ApiError } from '../api'
import { useClient } from '../client'
import { useConsole } from '../console/context'
import { clockTime, dateTime, duration, incidentRef, sentence, timeAgo } from '../lib/format'
import { canRespond } from '../lib/roles'
import { href } from '../lib/router'
import type { IncidentDetail, IncidentEvent, IncidentStatus, IncidentTask, OrganizationMember, Postmortem, TaskStatus } from '../types'
import { SeverityBadge, StatusBadge } from '../ui/Badges'
import { Dialog } from '../ui/Dialog'
import { useAction, useResource } from '../ui/hooks'
import { Empty, ErrorState, Loading, PageHeader, Panel, Spinner } from '../ui/Layout'

const lifecycle: { status: IncidentStatus; label: string; hint: string }[] = [
  { status: 'investigating', label: 'Investigating', hint: 'Impact confirmed, cause unknown' },
  { status: 'identified', label: 'Identified', hint: 'Cause known, fix in progress' },
  { status: 'monitoring', label: 'Monitoring', hint: 'Fix deployed, watching recovery' },
  { status: 'resolved', label: 'Resolved', hint: 'Impact over' },
]

const nextAction: Partial<Record<IncidentStatus, { to: IncidentStatus; label: string; placeholder: string }>> = {
  investigating: { to: 'identified', label: 'Mark cause identified', placeholder: 'What is the cause?' },
  identified: { to: 'monitoring', label: 'Fix deployed – start monitoring', placeholder: 'What changed?' },
  monitoring: { to: 'resolved', label: 'Resolve incident', placeholder: 'How was recovery confirmed?' },
}

export function IncidentPage({ id }: { id: string }) {
  const { client } = useClient()
  const { organizationId, token, revision, overview, membership } = useConsole()
  const incident = useResource(() => client.incident(organizationId, id, token), `${organizationId}:${id}:${revision}`)
  const members = useResource(() => client.members(organizationId, token), organizationId)
  const responder = canRespond(membership.role)

  if (incident.error && !incident.data) {
    return (
      <>
        <BackLink />
        <ErrorState message={incident.error === 'Incident not found' ? 'This incident doesn’t exist in this workspace.' : incident.error} retry={incident.reload} />
      </>
    )
  }
  if (!incident.data) return <><BackLink /><Loading label="Loading incident…" /></>

  const data = incident.data
  const service = overview.services.find((item) => item.id === data.service_id)
  const names = new Map((members.data ?? []).map((member) => [member.user_id, member.full_name]))
  const editable = responder && data.status !== 'resolved'

  return (
    <>
      {incident.error && <div className="inline-alert" role="status">Couldn’t refresh this incident ({incident.error}). Showing the last loaded version.</div>}
      <PageHeader
        back={<BackLink />}
        title={data.title}
        description={
          <span className="incident-facts">
            <SeverityBadge severity={data.severity} />
            <StatusBadge status={data.status} />
            <span className="mono">{incidentRef(data.id)}</span>
            {service && <a className="link" href={href({ page: 'services' })}>{service.name}</a>}
            <span>{data.status === 'resolved' && data.resolved_at ? `Lasted ${duration(data.created_at, data.resolved_at)}` : `Open ${duration(data.created_at)}`}</span>
          </span>
        }
      />
      <Lifecycle incident={data} editable={editable} onChanged={incident.reload} />
      <div className="incident-grid">
        <div className="stack">
          {data.summary && <Panel title="Impact"><p className="prose">{data.summary}</p></Panel>}
          <Timeline incident={data} names={names} editable={editable} onChanged={incident.reload} />
        </div>
        <div className="stack">
          <Tasks incident={data} editable={editable} onChanged={incident.reload} />
          <Details incident={data} names={names} members={members.data} />
          {data.status === 'resolved' && <PostmortemPanel incident={data} canGenerate={responder} />}
        </div>
      </div>
    </>
  )
}

function BackLink() {
  return <a className="back-link" href={href({ page: 'incidents' })}><ArrowLeft size={15} />Incidents</a>
}

function Lifecycle({ incident, editable, onChanged }: { incident: IncidentDetail; editable: boolean; onChanged: () => Promise<void> }) {
  const { client } = useClient()
  const { organizationId, token, refresh } = useConsole()
  const { pending, run } = useAction()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const current = lifecycle.findIndex((step) => step.status === incident.status)
  const next = nextAction[incident.status]

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!next) return
    const updated = await run('status', () => client.updateIncidentStatus(organizationId, incident.id, next.to, message.trim() || null, token),
      next.to === 'resolved' ? 'Incident resolved' : `Status set to ${next.to}`)
    if (!updated) return
    setOpen(false); setMessage('')
    await Promise.all([onChanged(), refresh()])
  }

  return (
    <section className="lifecycle" aria-label="Incident lifecycle">
      <ol>
        {lifecycle.map((step, index) => (
          <li key={step.status} className={index < current ? 'done' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined}>
            <span className="lifecycle-marker" aria-hidden="true">{index < current || incident.status === 'resolved' ? <Check size={13} /> : index + 1}</span>
            <span className="lifecycle-text"><b>{step.label}</b><small>{step.hint}</small></span>
          </li>
        ))}
      </ol>
      {editable && next && (
        <button type="button" className={`button ${next.to === 'resolved' ? 'success' : 'primary'}`} onClick={() => setOpen(true)}>{next.label}</button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={next?.label ?? ''} description={next?.to === 'resolved' ? 'The affected service returns to operational only when no other open incident still affects it.' : 'This update is posted to the timeline and sent to subscribed webhooks.'}>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Update for responders <small>Optional</small></span>
            <textarea rows={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={next?.placeholder} data-autofocus />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className={`button ${next?.to === 'resolved' ? 'success' : 'primary'}`} disabled={pending !== null}>{pending && <Spinner />}{next?.label}</button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}

const eventIcons: Record<string, ReactNode> = {
  'incident.created': <Siren size={14} />,
  'alert.triggered': <Radio size={14} />,
  'alert.deduplicated': <CopyPlus size={14} />,
  'note.added': <MessageSquare size={14} />,
  'incident.status_changed': <Workflow size={14} />,
  'task.created': <ListChecks size={14} />,
  'task.status_changed': <ListChecks size={14} />,
}

const eventLabels: Record<string, string> = {
  'incident.created': 'Declared',
  'alert.triggered': 'Alert received',
  'alert.deduplicated': 'Repeat alert grouped',
  'note.added': 'Update',
  'incident.status_changed': 'Status changed',
  'task.created': 'Task added',
  'task.status_changed': 'Task updated',
}

function actorName(event: IncidentEvent, names: Map<string, string>): string {
  if (event.actor_id) return names.get(event.actor_id) ?? 'Former member'
  const source = event.event_metadata?.source
  return typeof source === 'string' ? source : 'Integration'
}

function Timeline({ incident, names, editable, onChanged }: { incident: IncidentDetail; names: Map<string, string>; editable: boolean; onChanged: () => Promise<void> }) {
  const { client } = useClient()
  const { organizationId, token } = useConsole()
  const { pending, run } = useAction()
  const [note, setNote] = useState('')
  const events = useMemo(() => [...incident.events].sort((a, b) => b.created_at.localeCompare(a.created_at)), [incident.events])

  async function post(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    const result = await run('note', () => client.addIncidentNote(organizationId, incident.id, note.trim(), token))
    if (!result) return
    setNote('')
    await onChanged()
  }

  return (
    <Panel title="Timeline" description={`${events.length} entries, newest first`}>
      {editable && (
        <form className="composer" onSubmit={post}>
          <label className="sr-only" htmlFor="timeline-note">Post an update</label>
          <textarea id="timeline-note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Post an update: what you tried, what you saw, what’s next"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }} />
          <div className="composer-foot">
            <small>Ctrl + Enter to post</small>
            <button className="button primary" disabled={pending !== null || !note.trim()}>{pending && <Spinner />}Post update</button>
          </div>
        </form>
      )}
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.id} className={`timeline-item kind-${event.event_type.split('.')[0]}`}>
            <span className="timeline-icon" aria-hidden="true">{eventIcons[event.event_type] ?? <CircleDashed size={14} />}</span>
            <div className="timeline-content">
              <div className="timeline-head">
                <b>{eventLabels[event.event_type] ?? sentence(event.event_type)}</b>
                <span>{actorName(event, names)}</span>
                <time dateTime={event.created_at} title={dateTime(event.created_at)}>{clockTime(event.created_at)}</time>
              </div>
              <p>{event.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

const nextTaskStatus: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'done' }

function Tasks({ incident, editable, onChanged }: { incident: IncidentDetail; editable: boolean; onChanged: () => Promise<void> }) {
  const { client } = useClient()
  const { organizationId, token } = useConsole()
  const { pending, run } = useAction()
  const [title, setTitle] = useState('')
  const done = incident.tasks.filter((task) => task.status === 'done').length

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    if (!await run('add', () => client.createIncidentTask(organizationId, incident.id, title.trim(), token))) return
    setTitle('')
    await onChanged()
  }

  async function advance(task: IncidentTask) {
    if (task.status === 'done') return
    if (!await run(task.id, () => client.updateIncidentTask(organizationId, incident.id, task.id, nextTaskStatus[task.status], token))) return
    await onChanged()
  }

  return (
    <Panel title="Response tasks" description={incident.tasks.length ? `${done} of ${incident.tasks.length} done` : undefined}>
      {incident.tasks.length > 0 && (
        <div className="progress" aria-hidden="true"><span style={{ width: `${(done / incident.tasks.length) * 100}%` }} /></div>
      )}
      {incident.tasks.length === 0 && <p className="muted-text">{editable ? 'Split the response into owned pieces of work.' : 'No tasks were tracked for this incident.'}</p>}
      <ul className="task-list">
        {incident.tasks.map((task) => (
          <li key={task.id}>
            <button type="button" className={`task task-${task.status}`} disabled={!editable || task.status === 'done' || pending === task.id} onClick={() => advance(task)}
              aria-label={`${task.title}: ${task.status === 'todo' ? 'to do' : task.status === 'doing' ? 'in progress' : 'done'}${editable && task.status !== 'done' ? '. Activate to advance.' : ''}`}>
              <span className="task-check" aria-hidden="true">{pending === task.id ? <Spinner /> : task.status === 'done' ? <Check size={13} /> : task.status === 'doing' ? <Loader size={13} /> : null}</span>
              <span className="task-title">{task.title}</span>
              <StatusBadge status={task.status} />
            </button>
          </li>
        ))}
      </ul>
      {editable && (
        <form className="inline-form" onSubmit={add}>
          <label className="sr-only" htmlFor="task-title">New task</label>
          <input id="task-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task, e.g. page the database on-call" />
          <button className="button" disabled={pending === 'add' || !title.trim()}>Add task</button>
        </form>
      )}
    </Panel>
  )
}

function Details({ incident, names, members }: { incident: IncidentDetail; names: Map<string, string>; members: OrganizationMember[] | null }) {
  const commander = incident.commander_id ? names.get(incident.commander_id) ?? (members ? 'Former member' : '…') : 'Unassigned (opened by alert)'
  return (
    <Panel title="Details">
      <dl className="details">
        <div><dt>Commander</dt><dd>{commander}</dd></div>
        <div><dt>Declared</dt><dd>{dateTime(incident.created_at)} <small>{timeAgo(incident.created_at)}</small></dd></div>
        {incident.resolved_at && <div><dt>Resolved</dt><dd>{dateTime(incident.resolved_at)}</dd></div>}
        <div><dt>Reference</dt><dd className="mono">{incidentRef(incident.id)}</dd></div>
      </dl>
    </Panel>
  )
}

function PostmortemPanel({ incident, canGenerate }: { incident: IncidentDetail; canGenerate: boolean }) {
  const { client } = useClient()
  const { organizationId, token } = useConsole()
  const { pending, run } = useAction()
  const existing = useResource<Postmortem | null>(async () => {
    try {
      return await client.postmortem(organizationId, incident.id, token)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }, `${organizationId}:${incident.id}`)

  async function generate() {
    const created = await run('generate', () => client.generatePostmortem(organizationId, incident.id, token), 'Postmortem draft created')
    if (created) existing.setData(created)
  }

  if (existing.error) return <Panel title="Postmortem"><ErrorState message={existing.error} retry={existing.reload} /></Panel>
  if (!existing.loaded) return <Panel title="Postmortem"><Loading /></Panel>
  if (existing.data === null) {
    return (
      <Panel title="Postmortem">
        <Empty icon={<FileText size={20} />} title="No postmortem yet"
          action={canGenerate && <button type="button" className="button primary" disabled={pending !== null} onClick={generate}>{pending && <Spinner />}Draft from timeline</button>}>
          Aegis drafts the summary, impact and resolution from this incident’s record. The root cause stays open until your team confirms it.
        </Empty>
      </Panel>
    )
  }
  const pm = existing.data!
  return (
    <Panel title="Postmortem" description={`Draft created ${timeAgo(pm.created_at)}`} className="postmortem">
      <dl>
        <dt>Summary</dt><dd>{pm.summary}</dd>
        <dt>Customer impact</dt><dd>{pm.customer_impact}</dd>
        <dt>Root cause</dt><dd className="pending-review">{pm.root_cause}</dd>
        <dt>Resolution</dt><dd>{pm.resolution}</dd>
        <dt>Follow-up actions</dt>
        <dd><ul>{pm.follow_up_actions.map((action) => <li key={action}>{action}</li>)}</ul></dd>
      </dl>
    </Panel>
  )
}
