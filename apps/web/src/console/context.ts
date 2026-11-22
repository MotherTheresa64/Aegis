import { createContext, useContext } from 'react'

import type { Membership, Overview, User } from '../types'

export type ConsoleDialog = 'incident' | 'service' | 'simulate'

export interface ConsoleValue {
  user: User
  token: string
  membership: Membership
  organizationId: string
  overview: Overview
  /** Bumps on every realtime event or local mutation so pages can refetch their own data. */
  revision: number
  refresh: () => Promise<void>
  openDialog: (dialog: ConsoleDialog) => void
}

export const ConsoleContext = createContext<ConsoleValue | null>(null)

export function useConsole(): ConsoleValue {
  const value = useContext(ConsoleContext)
  if (!value) throw new Error('useConsole must be used inside the console')
  return value
}
