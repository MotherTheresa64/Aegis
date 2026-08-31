import type {
  AnalyticsOverview,
  ApiKeyCreated,
  ApiKeySummary,
  Dependency,
  IncidentDetail,
  IncidentTask,
  Membership,
  Overview,
  Postmortem,
  PublicStatus,
  TaskStatus,
  User,
} from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      message = body.detail || message
    } catch {
      // Keep the generic message for non-JSON failures.
    }
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
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
  overview: (organizationId: string, token: string) =>
    request<Overview>(`/api/v1/organizations/${organizationId}/overview`, {}, token),
  createService: (organizationId: string, payload: { name: string; description: string }, token: string) =>
    request(`/api/v1/organizations/${organizationId}/services`, {
      method: 'POST', body: JSON.stringify(payload),
    }, token),
  simulateOutage: (organizationId: string, serviceId: string, token: string) =>
    request(`/api/v1/organizations/${organizationId}/alerts/simulate`, {
      method: 'POST',
      body: JSON.stringify({ service_id: serviceId, severity: 'sev1', title: 'Elevated production error rate' }),
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
  publicStatus: (organizationSlug: string) =>
    request<PublicStatus>(`/api/v1/status/${organizationSlug}`),
  postmortem: (organizationId: string, incidentId: string, token: string) =>
    request<Postmortem>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/postmortem`, {}, token),
  generatePostmortem: (organizationId: string, incidentId: string, token: string) =>
    request<Postmortem>(`/api/v1/organizations/${organizationId}/incidents/${incidentId}/postmortem/generate`, {
      method: 'POST',
    }, token),
}
