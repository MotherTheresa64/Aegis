export type Role = 'owner' | 'admin' | 'engineer' | 'responder' | 'viewer'
export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4'

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
  created_by_id: string
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

export interface IncidentDetail extends Incident {
  events: IncidentEvent[]
}

export interface Overview {
  services_total: number
  services_impacted: number
  active_incidents: number
  sev1_incidents: number
  services: Service[]
  incidents: Incident[]
}
