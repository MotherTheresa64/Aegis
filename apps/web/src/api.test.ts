import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Aegis API client', () => {
  it('sends authenticated API-key revocation as DELETE and handles 204', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )

    await expect(api.revokeApiKey('org-123', 'key-456', 'token-789')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/organizations/org-123/api-keys/key-456')
    expect(options?.method).toBe('DELETE')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer token-789')
  })

  it('surfaces server detail through ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Insufficient role' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(api.apiKeys('org-123', 'viewer-token')).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient role',
    } satisfies Partial<ApiError>)
  })

  it('does not force JSON content type onto public GET requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        organization_name: 'Reliability Lab',
        organization_slug: 'reliability-lab',
        overall_status: 'operational',
        services: [],
        active_incidents: [],
        generated_at: '2026-09-03T08:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    await api.publicStatus('reliability-lab')

    const [, options] = fetchMock.mock.calls[0]
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
    expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  })

  it('sets JSON content type when a request has a JSON body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'token', user: { id: 'u1', email: 'a@example.com', full_name: 'A User', created_at: '2026-09-03T08:00:00Z' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await api.login({ email: 'a@example.com', password: 'password123' })

    const [, options] = fetchMock.mock.calls[0]
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json')
  })

  it('turns transport failures into a user-facing network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(api.publicStatus('reliability-lab')).rejects.toMatchObject({
      status: 0,
      message: 'Aegis could not reach the server. Check your connection and try again.',
    } satisfies Partial<ApiError>)
  })
})
