/**
 * Portfolio showcase gate.
 *
 * The hosted Aegis link ships the interface on seeded data with no working API,
 * so the sign-in form there can never succeed. A build whose API is unreachable
 * sends the visitor straight to the seeded demo instead of showing a form that
 * fails. A session guard means "Exit demo" still reaches the real app, which is
 * what a locally running full stack needs.
 */
const API_URL = import.meta.env.VITE_API_URL
const PROBE_TIMEOUT_MS = 2500
const DEMO_PATH = '/demo'
const GUARD_KEY = 'aegis-showcase-redirect'

async function apiReachable(): Promise<boolean> {
  if (!API_URL) return false
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_URL}/health`, { signal: controller.signal, cache: 'no-store' })
    return response.ok
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timer)
  }
}

export async function resolveShowcaseRoute(): Promise<void> {
  const { pathname } = window.location
  if (pathname !== '/' && pathname !== '/index.html') return
  if (sessionStorage.getItem(GUARD_KEY) === '1') return
  if (await apiReachable()) return
  try { sessionStorage.setItem(GUARD_KEY, '1') } catch { /* Redirect still helps without storage. */ }
  window.location.replace(DEMO_PATH)
}
