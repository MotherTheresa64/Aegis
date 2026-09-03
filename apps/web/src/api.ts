import type {
  AnalyticsOverview,
  ApiKeyCreated,
  ApiKeySummary,
  AuditEvent,
  Dependency,
  Incident,
  IncidentDetail,
  IncidentStatus,
  IncidentTask,
  InvitationCreated,
  InvitationPreview,
  Membership,
  OrganizationMember,
  Overview,
  Postmortem,
  PublicStatus,
  Role,
  Severity,
  TaskStatus,
  User,
  WebhookCreated,
  WebhookDelivery,
  WebhookEndpoint,
} from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'
const REQUEST_TIMEOUT_MS = 12_000

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body != null && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const upstreamSignal = options.signal
  const abortFromUpstream = () => controller.abort()
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort()
    else upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true })
  }

  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal })
    if (!response.ok) {
      let message = response.status === 401
        ? 'Your session has expired. Please sign in again.'
        : `Request failed (${response.status})`
      try {
        const body = await response.json()
        if (body.detail) message = body.detail
      } catch {
        // Keep the status-aware fallback for non-JSON failures.
      }
      throw new ApiError(response.status, message)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) throw new ApiError(0, 'The request timed out. Check your connection and try again.')
    throw new ApiError(0, 'Aegis could not reach the server. Check your connection and try again.')
  } finally {
    window.clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
}

export const api = {
  register: (payload: { email: string; full_name: string; password: string; organization_name: string }) =>
    request<{ access_token: string; user: User }>('/api/v1/auth/register', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<{ access_token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  me: (token: string) => request<User>('/api/v1/auth/me', {}, token),
  memberships: (token: string) => request<Membership[]>('/api/v1/auth/memberships', {}, token),
  realtimeTicket: (organizationId: string, token: string) =>
    request<{ ticket: string; expires_in: number }>(`/api/v1/organizations/${organizationId}/realtime-ticket`, {
      method: 'POST',
    }, token),
  overview: (organizationId: string, token: string) =>
    request<Overview>(`/api/v1/organizations/${organizationId}/overview`, {}, token),

  createService: (organizationId: string, payload: { name: string; description: string }, token: string) =>
    request(`/api/v1/organizations/${organizationId}/services`, {
      method: 'POST', body: JSON.stringify(payload),
    }, token),
  updateServiceStatus: (organizationId: string, serviceId: string, status: string, token: string) =>
    request(`/api/v1/organizations/${organizationId}/services/${serviceId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }, token),
  simulateOutage: (organizationId: string, serviceId: string, token: string) =>
    request(`/api/v1/organizations/${organizationId}/alerts/simulate`, {
      method: 'POST',
      body: JSON.stringify({ service_id: serviceId, severity: 'sev1', title: 'Elevated production error rate' }),
    }, token),

  createIncident: (
    organizationId: string,
    payload: { title: string; summary: string; severity: Severity; service_id: string | null },
    token: string,
  ) => request<Incident>(`/api/v1/organizations/${organizationId}/incidents`, {
    method: 'POST', body: JSON.stringify(payload),
  }, token),
  updateIncidentStatus: (
    organizationId: string,
    incidentId: string,
    status: IncidentStatus,
    message: string | null,
    token: string,
  ) => request<Incident>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/status`, {
    method: 'PATCH', body: JSON.stringify({ status, message }),
  }, token),
  resolveIncident: (organizationId: string, incidentId: string, token: string) =>
    request(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'resolved', message: 'Service recovered and incident resolved.' }),
    }, token),
  incident: (organizationId: string, incidentId: string, token: string) =>
    request<IncidentDetail>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}`, {}, token),
  addIncidentNote: (organizationId: string, incidentId: string, message: string, token: string) =>
    request<IncidentDetail>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/events`, {
      method: 'POST', body: JSON.stringify({ message }),
    }, token),
  createIncidentTask: (organizationId: string, incidentId: string, title: string, token: string) =>
    request<IncidentTask>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/tasks`, {
      method: 'POST', body: JSON.stringify({ title }),
    }, token),
  updateIncidentTask: (
    organizationId: string,
    incidentId: string,
    taskId: string,
    taskStatus: TaskStatus,
    token: string,
  ) => request<IncidentTask>(
    `/api/v1/organizations/${organizationId}/incidents/${incidentId}/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify({ status: taskStatus }) },
    token,
  ),

  dependencies: (organizationId: string, token: string) =>
    request<Dependency[]>(`/api/v1/organizations/${organizationId}/dependencies`, {}, token),
  createDependency: (
    organizationId: string,
    sourceServiceId: string,
    targetServiceId: string,
    token: string,
  ) => request<Dependency>(`/api/v1/organizations/${organizationId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ source_service_id: sourceServiceId, target_service_id: targetServiceId, relationship: 'depends_on' }),
  }, token),
  analytics: (organizationId: string, token: string) =>
    request<AnalyticsOverview>(`/api/v1/organizations/${organizationId}/analytics/overview`, {}, token),

  apiKeys: (organizationId: string, token: string) =>
    request<ApiKeySummary[]>(`/api/v1/organizations/${organizationId}/api-keys`, {}, token),
  createApiKey: (organizationId: string, name: string, token: string) =>
    request<ApiKeyCreated>(`/api/v1/organizations/${organizationId}/api-keys`, {
      method: 'POST', body: JSON.stringify({ name }),
    }, token),
  revokeApiKey: (organizationId: string, apiKeyId: string, token: string) =>
    request<void>(`/api/v1/organizations/${organizationId}/api-keys/${apiKeyId}`, {
      method: 'DELETE',
    }, token),

  members: (organizationId: string, token: string) =>
    request<OrganizationMember[]>(`/api/v1/organizations/${organizationId}/members`, {}, token),
  createInvitation: (organizationId: string, email: string, role: Role, token: string) =>
    request<InvitationCreated>(`/api/v1/organizations/${organizationId}/invitations`, {
      method: 'POST', body: JSON.stringify({ email, role }),
    }, token),
  previewInvitation: (invitationToken: string) =>
    request<InvitationPreview>(`/api/v1/invitations/${encodeURIComponent(invitationToken)}`),
  acceptInvitation: (invitationToken: string, token: string) =>
    request<OrganizationMember>(`/api/v1/invitations/${encodeURIComponent(invitationToken)}/accept`, {
      method: 'POST',
    }, token),
  updateMemberRole: (organizationId: string, userId: string, role: Role, token: string) =>
    request<OrganizationMember>(`/api/v1/organizations/${organizationId}/members/${userId}`, {
      method: 'PATCH', body: JSON.stringify({ role }),
    }, token),
  removeMember: (organizationId: string, userId: string, token: string) =>
    request<void>(`/api/v1/organizations/${organizationId}/members/${userId}`, {
      method: 'DELETE',
    }, token),

  webhooks: (organizationId: string, token: string) =>
    request<WebhookEndpoint[]>(`/api/v1/organizations/${organizationId}/webhooks`, {}, token),
  createWebhook: (
    organizationId: string,
    payload: { name: string; url: string; event_types: string[] },
    token: string,
  ) => request<WebhookCreated>(`/api/v1/organizations/${organizationId}/webhooks`, {
    method: 'POST', body: JSON.stringify(payload),
  }, token),
  setWebhookEnabled: (organizationId: string, endpointId: string, enabled: boolean, token: string) =>
    request<WebhookEndpoint>(`/api/v1/organizations/${organizationId}/webhooks/${endpointId}`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    }, token),
  webhookDeliveries: (organizationId: string, token: string) =>
    request<WebhookDelivery[]>(`/api/v1/organizations/${organizationId}/webhooks/deliveries`, {}, token),
  retryWebhookDelivery: (organizationId: string, deliveryId: string, token: string) =>
    request<WebhookDelivery>(`/api/v1/organizations/${organizationId}/webhooks/deliveries/${deliveryId}/retry`, {
      method: 'POST',
    }, token),

  auditEvents: (organizationId: string, token: string, limit = 50) =>
    request<AuditEvent[]>(`/api/v1/organizations/${organizationId}/audit?limit=${limit}`, {}, token),
  publicStatus: (organizationSlug: string) =>
    request<PublicStatus>(`/api/v1/status/${encodeURIComponent(organizationSlug)}`),
  postmortem: (organizationId: string, incidentId: string, token: string) =>
    request<Postmortem>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/postmortem`, {}, token),
  generatePostmortem: (organizationId: string, incidentId: string, token: string) =>
    request<Postmortem>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/postmortem/generate`, {
      method: 'POST',
    }, token),
}
