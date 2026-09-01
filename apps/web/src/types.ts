export type Role = 'owner' | 'admin' | 'engineer' | 'responder' | 'viewer'
export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4'
export type TaskStatus = 'todo' | 'doing' | 'done'

export interface User {
  id: string
  email: string
  full_name: string
  created_at: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface Membership {
  organization: Organization
  role: Role
}

export interface Service {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string
  status: ServiceStatus
  created_at: string
}

export interface Incident {
  id: string
  organization_id: string
  service_id: string | null
  created_by_id: string | null
  commander_id: string | null
  title: string
  summary: string
  severity: Severity
  status: IncidentStatus
  created_at: string
  resolved_at: string | null
}

export interface IncidentEvent {
  id: string
  incident_id: string
  actor_id: string | null
  event_type: string
  message: string
  event_metadata: Record<string, unknown>
  created_at: string
}

export interface IncidentTask {
  id: string
  incident_id: string
  assigned_to_id: string | null
  title: string
  status: TaskStatus
  created_at: string
  completed_at: string | null
}

export interface IncidentDetail extends Incident {
  events: IncidentEvent[]
  tasks: IncidentTask[]
}

export interface Overview {
  services_total: number
  services_impacted: number
  active_incidents: number
  sev1_incidents: number
  services: Service[]
  incidents: Incident[]
}

export interface Dependency {
  id: string
  organization_id: string
  source_service_id: string
  target_service_id: string
  relationship: string
  created_at: string
}

export interface AnalyticsOverview {
  incidents_30d: number
  resolved_30d: number
  sev1_30d: number
  mean_time_to_resolve_minutes: number | null
  current_active: number
  current_impacted_services: number
}

export interface ApiKeySummary {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
  created_at: string
}

export interface ApiKeyCreated extends ApiKeySummary {
  key: string
}

export interface PublicStatus {
  organization_name: string
  organization_slug: string
  overall_status: ServiceStatus
  services: Service[]
  active_incidents: Incident[]
  generated_at: string
}

export interface Postmortem {
  id: string
  incident_id: string
  status: 'draft' | 'published'
  summary: string
  customer_impact: string
  root_cause: string
  resolution: string
  follow_up_actions: string[]
  created_at: string
  updated_at: string
}

export interface AuditEvent {
  id: string
  organization_id: string
  actor_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  details: Record<string, unknown>
  created_at: string
}
