import { createContext, useContext, type ReactNode } from 'react'

import { api } from './api'

export type ApiClient = typeof api

interface ClientContextValue {
  client: ApiClient
  /** Demo workspaces run against in-browser data: no realtime socket, nothing persisted. */
  demo: boolean
}

const ClientContext = createContext<ClientContextValue>({ client: api, demo: false })

export function ClientProvider({ client, demo, children }: ClientContextValue & { children: ReactNode }) {
  return <ClientContext.Provider value={{ client, demo }}>{children}</ClientContext.Provider>
}

export const useClient = () => useContext(ClientContext)
