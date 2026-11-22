export function timeAgo(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Compact elapsed time between two instants, e.g. "1h 12m". */
export function duration(from: string, to: string | null = null, now = Date.now()): string {
  const end = to ? new Date(to).getTime() : now
  const minutes = Math.max(0, Math.round((end - new Date(from).getTime()) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function sentence(value: string): string {
  const text = value.replaceAll('_', ' ').replaceAll('.', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

export function incidentRef(id: string): string {
  return `INC-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

export function dateTime(value: string): string {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function clockTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
