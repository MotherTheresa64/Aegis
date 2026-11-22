import type { IncidentStatus, ServiceStatus, Severity, TaskStatus, WebhookDeliveryStatus } from '../types'
import { sentence } from '../lib/format'

const severityLabel: Record<Severity, string> = { sev1: 'SEV1', sev2: 'SEV2', sev3: 'SEV3', sev4: 'SEV4' }
const severityTitle: Record<Severity, string> = {
  sev1: 'Critical', sev2: 'Major', sev3: 'Moderate', sev4: 'Minor',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sev sev-${severity}`} title={`${severityTitle[severity]} severity`}>{severityLabel[severity]}</span>
}

export const severityOptions: { value: Severity; label: string }[] = (['sev1', 'sev2', 'sev3', 'sev4'] as Severity[])
  .map((value) => ({ value, label: `${severityLabel[value]} – ${severityTitle[value]}` }))

type AnyStatus = ServiceStatus | IncidentStatus | TaskStatus | WebhookDeliveryStatus

const statusTone: Record<AnyStatus, string> = {
  operational: 'ok', degraded: 'warn', outage: 'bad', maintenance: 'info',
  investigating: 'bad', identified: 'warn', monitoring: 'info', resolved: 'ok',
  todo: 'muted', doing: 'info', done: 'ok',
  pending: 'muted', delivering: 'info', succeeded: 'ok', failed: 'warn', dead_letter: 'bad',
}

const statusText: Partial<Record<AnyStatus, string>> = { dead_letter: 'Dead letter', doing: 'In progress', todo: 'To do' }

export function StatusBadge({ status }: { status: AnyStatus }) {
  return (
    <span className={`status tone-${statusTone[status]}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusText[status] ?? sentence(status)}
    </span>
  )
}

export function RoleBadge({ role }: { role: string }) {
  return <span className="role">{sentence(role)}</span>
}
