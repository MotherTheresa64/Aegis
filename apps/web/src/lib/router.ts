import { useEffect, useState } from 'react'

/**
 * Hash routing inside the console (`#/incidents/<id>`). The app is served as static
 * files from hosts without rewrite rules, so path-based deep links would 404 there.
 */
export type Route =
  | { page: 'overview' }
  | { page: 'incidents' }
  | { page: 'incident'; id: string }
  | { page: 'services' }
  | { page: 'dependencies' }
  | { page: 'analytics' }
  | { page: 'integrations' }
  | { page: 'status' }
  | { page: 'team' }

const simplePages = new Set(['incidents', 'services', 'dependencies', 'analytics', 'integrations', 'status', 'team'])

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'incidents' && parts[1]) return { page: 'incident', id: parts[1] }
  if (parts[0] && simplePages.has(parts[0])) return { page: parts[0] } as Route
  return { page: 'overview' }
}

export function href(route: Route): string {
  if (route.page === 'overview') return '#/'
  if (route.page === 'incident') return `#/incidents/${encodeURIComponent(route.id)}`
  return `#/${route.page}`
}

export function navigate(route: Route) {
  window.location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
