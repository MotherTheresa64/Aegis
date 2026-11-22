import type { Dependency, Service } from '../types'

/**
 * Services that transitively depend on any impacted service. An edge `source -> target`
 * means source depends on target, so impact flows from target back to source.
 */
export function servicesAtRisk(services: Service[], dependencies: Dependency[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>()
  for (const edge of dependencies) {
    dependents.set(edge.target_service_id, [...(dependents.get(edge.target_service_id) ?? []), edge.source_service_id])
  }
  const impacted = services.filter((service) => service.status === 'outage' || service.status === 'degraded')
  const atRisk = new Map<string, string[]>()
  for (const origin of impacted) {
    const queue = [origin.id]
    const seen = new Set(queue)
    while (queue.length) {
      for (const dependent of dependents.get(queue.shift()!) ?? []) {
        if (seen.has(dependent)) continue
        seen.add(dependent)
        queue.push(dependent)
        atRisk.set(dependent, [...(atRisk.get(dependent) ?? []), origin.id])
      }
    }
  }
  for (const origin of impacted) atRisk.delete(origin.id)
  return atRisk
}
