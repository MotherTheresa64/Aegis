import { useEffect, useRef, useState } from 'react'

import { ApiError, WS_URL } from '../api'
import type { ApiClient } from '../client'

export type RealtimeState = 'connecting' | 'live' | 'offline' | 'demo'

/**
 * Organization channel: fetch a one-time ticket over HTTPS, then open the socket with it.
 * Reconnects with jittered exponential backoff; 4403 means membership was revoked.
 */
export function useRealtime(options: {
  client: ApiClient
  enabled: boolean
  organizationId: string
  token: string
  onEvent: () => void
  onUnauthorized: () => void
  onForbidden: () => void
}): RealtimeState {
  const { client, enabled, organizationId, token } = options
  const [state, setState] = useState<RealtimeState>(enabled ? 'connecting' : 'demo')
  const handlers = useRef(options)
  handlers.current = options

  useEffect(() => {
    if (!enabled || !organizationId) return
    let socket: WebSocket | null = null
    let keepAlive: number | undefined
    let retryTimer: number | undefined
    let attempt = 0
    let cancelled = false

    const scheduleRetry = () => {
      if (cancelled) return
      setState('offline')
      const delay = Math.min(1000 * 2 ** attempt, 15000) * (0.8 + Math.random() * 0.4)
      attempt += 1
      retryTimer = window.setTimeout(connect, delay)
    }

    async function connect() {
      try {
        setState((current) => (current === 'live' ? 'connecting' : current))
        const { ticket } = await client.realtimeTicket(organizationId, token)
        if (cancelled) return
        socket = new WebSocket(`${WS_URL}/ws/organizations/${organizationId}?ticket=${encodeURIComponent(ticket)}`)
        socket.onopen = () => {
          attempt = 0
          setState('live')
          keepAlive = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25000)
        }
        socket.onmessage = (message) => {
          try {
            if (JSON.parse(message.data).type === 'connected') return
          } catch {
            // Unknown payloads still mean something changed.
          }
          handlers.current.onEvent()
        }
        socket.onclose = (event) => {
          window.clearInterval(keepAlive)
          if (event.code === 4403) handlers.current.onForbidden()
          scheduleRetry()
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return handlers.current.onUnauthorized()
        if (err instanceof ApiError && err.status === 403) handlers.current.onForbidden()
        scheduleRetry()
      }
    }

    void connect()
    return () => {
      cancelled = true
      window.clearInterval(keepAlive)
      window.clearTimeout(retryTimer)
      socket?.close(1000, 'Workspace changed')
    }
  }, [client, enabled, organizationId, token])

  return enabled ? state : 'demo'
}
