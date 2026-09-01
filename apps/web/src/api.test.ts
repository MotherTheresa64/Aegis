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
})
