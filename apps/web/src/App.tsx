import { useEffect, useMemo, useState } from 'react'

import { api } from './api'
import { AuthScreen, InvitationAcceptance } from './auth/AuthScreen'
import { ClientProvider } from './client'
import { Brand, Console } from './console/Console'
import { DemoBanner } from './demo/DemoGuide'
import { createDemoApi, DEMO_TOKEN, demoUser } from './demo/demoApi'
import { PublicStatusPage } from './public/PublicStatusView'
import type { InvitationPreview, User } from './types'
import { FeedbackProvider } from './ui/Feedback'
import { errorMessage } from './ui/hooks'
import { Loading } from './ui/Layout'

const TOKEN_KEY = 'aegis_token'

type Entry =
  | { kind: 'status'; slug: string }
  | { kind: 'demo' }
  | { kind: 'app'; invitationToken: string }

export function resolveEntry(pathname: string): Entry {
  const status = pathname.match(/^\/status\/([^/]+)\/?$/)
  if (status) return { kind: 'status', slug: decodeURIComponent(status[1]) }
  if (/^\/demo\/?$/.test(pathname)) return { kind: 'demo' }
  const invite = pathname.match(/^\/invite\/([^/]+)\/?$/)
  return { kind: 'app', invitationToken: invite ? decodeURIComponent(invite[1]) : '' }
}

export default function App() {
  const entry = useMemo(() => resolveEntry(window.location.pathname), [])
  return (
    <FeedbackProvider>
      {entry.kind === 'status' ? <PublicStatusPage slug={entry.slug} />
        : entry.kind === 'demo' ? <DemoApp />
          : <AuthenticatedApp invitationToken={entry.invitationToken} />}
    </FeedbackProvider>
  )
}

function DemoApp() {
  const client = useMemo(createDemoApi, [])
  return (
    <ClientProvider client={client} demo>
      <Console token={DEMO_TOKEN} user={demoUser} onLogout={() => window.location.assign('/')} banner={<DemoBanner />} />
    </ClientProvider>
  )
}

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}

function AuthenticatedApp({ invitationToken }: { invitationToken: string }) {
  const [token, setToken] = useState(readToken)
  const [user, setUser] = useState<User | null>(null)
  const [validating, setValidating] = useState(Boolean(token))
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [inviteError, setInviteError] = useState('')

  useEffect(() => {
    if (!invitationToken) return
    api.previewInvitation(invitationToken).then(setInvitation).catch((err) => setInviteError(errorMessage(err, 'This invitation couldn’t be loaded.')))
  }, [invitationToken])

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.me(token)
      .then(setUser)
      .catch(() => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* nothing stored */ } setToken(''); setUser(null) })
      .finally(() => setValidating(false))
  }, [token])

  function authenticated(nextToken: string, nextUser: User) {
    try { localStorage.setItem(TOKEN_KEY, nextToken) } catch { /* Session lasts until reload. */ }
    setToken(nextToken); setUser(nextUser)
  }
  function logout() {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* nothing stored */ }
    setToken(''); setUser(null)
  }

  if (validating || (invitationToken && !invitation && !inviteError)) {
    return <div className="boot"><Brand /><Loading label="Checking your session…" /></div>
  }
  if (inviteError) {
    return (
      <div className="center-page">
        <div className="auth-card">
          <Brand />
          <h2>This invitation can’t be used</h2>
          <p className="muted-text">{inviteError}. Ask a workspace admin for a new link.</p>
          <a className="button large" href="/">Go to sign in</a>
        </div>
      </div>
    )
  }
  if (!token || !user) return <AuthScreen onAuthenticated={authenticated} invitation={invitation} />
  if (invitationToken && invitation) {
    return <InvitationAcceptance invitation={invitation} invitationToken={invitationToken} token={token} onLogout={logout}
      onAccepted={() => { window.history.replaceState({}, '', '/'); window.location.reload() }} />
  }
  return <Console token={token} user={user} onLogout={logout} />
}
