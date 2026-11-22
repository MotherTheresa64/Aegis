import { useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'

import { useClient } from '../client'
import { useConsole } from '../console/context'
import { dateTime, initials, sentence, timeAgo } from '../lib/format'
import { canAdminister, roleDescriptions } from '../lib/roles'
import type { AuditEvent, InvitationCreated, OrganizationMember, Role } from '../types'
import { RoleBadge } from '../ui/Badges'
import { useFeedback } from '../ui/Feedback'
import { useAction, useResource } from '../ui/hooks'
import { ErrorState, Loading, PageHeader, Panel, Spinner } from '../ui/Layout'

const invitable: Role[] = ['admin', 'engineer', 'responder', 'viewer']

export function TeamPage() {
  const { client } = useClient()
  const { organizationId, token, membership, user } = useConsole()
  const admin = canAdminister(membership.role)
  const members = useResource(() => client.members(organizationId, token), organizationId)
  const audit = useResource<AuditEvent[] | null>(() => (admin ? client.auditEvents(organizationId, token) : Promise.resolve(null)), `${organizationId}:${admin}`)

  return (
    <>
      <PageHeader title="Team & audit" description={<>Workspace <b>{membership.organization.name}</b>, you are {membership.role === 'admin' ? 'an' : 'a'} {membership.role}.</>} />
      <div className="stack">
        {admin && <Invite onInvited={members.reload} />}
        <Panel title="Members" description={members.data ? `${members.data.length} ${members.data.length === 1 ? 'person' : 'people'}` : undefined}>
          {members.error ? <ErrorState message={members.error} retry={members.reload} /> : !members.data ? <Loading /> : (
            <ul className="member-list">
              {members.data.map((member) => <MemberRow key={member.user_id} member={member} self={member.user_id === user.id} onChanged={members.reload} />)}
            </ul>
          )}
        </Panel>
        {admin && (
          <Panel title="Audit log" description="Security-relevant changes in this workspace, newest first.">
            {audit.error ? <ErrorState message={audit.error} retry={audit.reload} /> : !audit.data ? <Loading /> : audit.data.length === 0 ? <p className="muted-text">Nothing recorded yet.</p> : (
              <AuditTable events={audit.data} members={members.data ?? []} />
            )}
          </Panel>
        )}
      </div>
    </>
  )
}

function Invite({ onInvited }: { onInvited: () => Promise<void> }) {
  const { client, demo } = useClient()
  const { organizationId, token } = useConsole()
  const { toast } = useFeedback()
  const { pending, run } = useAction()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('responder')
  const [invitation, setInvitation] = useState<InvitationCreated | null>(null)
  const link = invitation ? `${window.location.origin}/invite/${invitation.token}` : ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = await run('invite', () => client.createInvitation(organizationId, email.trim(), role, token), 'Invitation created')
    if (!result) return
    setInvitation(result); setEmail('')
    await onInvited()
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); toast('Invitation link copied') } catch { toast('Copy failed – select the link and copy it manually', 'error') }
  }

  return (
    <Panel title="Invite someone" description="Aegis doesn’t send email. Share the link; it works only for the invited address and expires in 7 days.">
      <form className="invite-form" onSubmit={submit}>
        <label className="field"><span>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" /></label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {invitable.map((item) => <option key={item} value={item}>{sentence(item)}</option>)}
          </select>
        </label>
        <button className="button primary" disabled={pending !== null}>{pending && <Spinner />}Create invitation</button>
      </form>
      <p className="hint">{sentence(role)}: {roleDescriptions[role]}.</p>
      {invitation && (
        <div className="secret" role="status">
          <b>Invitation for {invitation.email}</b>
          <div className="secret-line">
            <code>{demo ? 'Invitation links are disabled in the demo' : link}</code>
            {!demo && <button type="button" className="button" onClick={copy}><Copy size={14} />Copy</button>}
          </div>
        </div>
      )}
    </Panel>
  )
}

function MemberRow({ member, self, onChanged }: { member: OrganizationMember; self: boolean; onChanged: () => Promise<void> }) {
  const { client } = useClient()
  const { organizationId, token, membership } = useConsole()
  const { confirm } = useFeedback()
  const { pending, run } = useAction()
  const admin = canAdminister(membership.role)
  const editable = admin && !self && (member.role !== 'owner' || membership.role === 'owner')
  const roles: Role[] = membership.role === 'owner' ? ['owner', ...invitable] : invitable

  async function changeRole(role: Role) {
    if (role === member.role) return
    if (await run('role', () => client.updateMemberRole(organizationId, member.user_id, role, token), `${member.full_name} is now ${role === 'admin' ? 'an' : 'a'} ${role}`)) await onChanged()
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove ${member.full_name}?`,
      body: 'They lose access to this workspace right away, including any open live sessions.',
      confirmLabel: 'Remove member',
      destructive: true,
    })
    if (ok && await run('remove', () => client.removeMember(organizationId, member.user_id, token).then(() => true), `${member.full_name} removed`)) await onChanged()
  }

  return (
    <li className="member">
      <span className="avatar" aria-hidden="true">{initials(member.full_name)}</span>
      <span className="member-main">
        <b>{member.full_name}{self && <span className="muted-text"> (you)</span>}</b>
        <small>{member.email}, joined {timeAgo(member.joined_at)}</small>
      </span>
      {editable ? (
        <label className="compact-select">
          <span className="sr-only">Role for {member.full_name}</span>
          <select value={member.role} disabled={pending !== null} onChange={(e) => changeRole(e.target.value as Role)}>
            {roles.map((role) => <option key={role} value={role}>{sentence(role)}</option>)}
          </select>
        </label>
      ) : <RoleBadge role={member.role} />}
      {editable && <button type="button" className="button ghost-danger" disabled={pending !== null} onClick={remove}>Remove</button>}
    </li>
  )
}

const auditLabels: Record<string, string> = {
  'incident.created': 'Declared an incident',
  'incident.status_changed': 'Changed incident status',
  'service.created': 'Added a service',
  'service.status_changed': 'Changed service status',
  'dependency.deleted': 'Removed a dependency',
  'alert.ingested': 'Alert opened an incident',
  'alert.deduplicated': 'Repeat alert grouped',
  'developer.api_key_created': 'Created an alert key',
  'developer.api_key_revoked': 'Revoked an alert key',
  'webhook.created': 'Added a webhook',
  'webhook.updated': 'Updated a webhook',
  'webhook.delivery_retried': 'Retried a webhook delivery',
  'postmortem.generated': 'Drafted a postmortem',
  'organization.invitation_created': 'Invited a member',
  'organization.invitation_accepted': 'Joined the workspace',
  'organization.member_role_changed': 'Changed a member’s role',
  'organization.member_removed': 'Removed a member',
}

function auditDetail(event: AuditEvent): string {
  const details = event.details ?? {}
  const parts: string[] = []
  for (const key of ['title', 'name', 'email'] as const) if (typeof details[key] === 'string') parts.push(String(details[key]))
  if (typeof details.from === 'string' && typeof details.to === 'string') parts.push(`${details.from} to ${details.to}`)
  else if (typeof details.role === 'string') parts.push(String(details.role))
  if (typeof details.api_key_prefix === 'string') parts.push(`key ${details.api_key_prefix}…`)
  return parts.join(', ')
}

function AuditTable({ events, members }: { events: AuditEvent[]; members: OrganizationMember[] }) {
  const names = new Map(members.map((member) => [member.user_id, member.full_name]))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Details</th></tr></thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td data-label="When"><time dateTime={event.created_at} title={dateTime(event.created_at)}>{timeAgo(event.created_at)}</time></td>
              <td data-label="Who">{event.actor_id ? names.get(event.actor_id) ?? 'Former member' : <span className="muted-text">Integration</span>}</td>
              <th scope="row" data-label="What"><b>{auditLabels[event.action] ?? sentence(event.action)}</b></th>
              <td data-label="Details" className="muted-text">{auditDetail(event) || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
