import type { Role } from '../types'

export const canEditCatalog = (role: Role) => role === 'owner' || role === 'admin' || role === 'engineer'
export const canRespond = (role: Role) => role !== 'viewer'
export const canAdminister = (role: Role) => role === 'owner' || role === 'admin'
export const canViewWebhooks = canEditCatalog

export const roleDescriptions: Record<Role, string> = {
  owner: 'Full control, including other owners',
  admin: 'Manages members, keys and webhooks',
  engineer: 'Edits services and dependencies, responds',
  responder: 'Runs incidents and response tasks',
  viewer: 'Read-only access',
}
