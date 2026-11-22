import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'

import { api, API_URL } from '../api'
import { Brand } from '../console/Console'
import type { InvitationPreview, User } from '../types'
import { errorMessage } from '../ui/hooks'
import { Spinner } from '../ui/Layout'

type Mode = 'login' | 'register'
type ServerState = 'checking' | 'ready' | 'waking' | 'unreachable'

/** Free hosting puts the API to sleep; a cold start takes up to a minute. Wake it on arrival
 * and say so, instead of letting the first sign-in hit the 12s request timeout. */
function useServerWake(): ServerState {
  const [state, setState] = useState<ServerState>('checking')
  useEffect(() => {
    let cancelled = false
    const started = Date.now()
    async function probe() {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 8000)
      try {
        if ((await fetch(`${API_URL}/health`, { signal: controller.signal, cache: 'no-store' })).ok) {
          if (!cancelled) setState('ready')
          return
        }
      } catch {
        // Asleep or offline; keep trying for a while.
      } finally {
        window.clearTimeout(timer)
      }
      if (cancelled) return
      if (Date.now() - started > 90_000) return setState('unreachable')
      setState('waking')
      window.setTimeout(probe, 3000)
    }
    void probe()
    return () => { cancelled = true }
  }, [])
  return state
}

export function AuthScreen({ onAuthenticated, invitation }: { onAuthenticated: (token: string, user: User) => void; invitation?: InvitationPreview | null }) {
  const [mode, setMode] = useState<Mode>(invitation ? 'login' : 'register')
  const [email, setEmail] = useState(invitation?.email ?? '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const server = useServerWake()

  useEffect(() => {
    if (invitation?.email) { setEmail(invitation.email); setMode('login') }
  }, [invitation?.email])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true); setError('')
    try {
      const result = mode === 'register'
        ? await api.register({ email: email.trim(), password, full_name: fullName.trim(), organization_name: organizationName.trim() })
        : await api.login({ email: email.trim(), password })
      onAuthenticated(result.access_token, result.user)
    } catch (err) {
      setError(errorMessage(err, 'Aegis couldn’t be reached. Check your connection and try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-intro">
        <Brand />
        <div className="auth-copy">
          <h1>Run incidents from first alert to postmortem.</h1>
          <p>Aegis takes alerts from your monitoring, opens the incident, keeps responders on one timeline, updates your status page and drafts the write-up.</p>
          <ul className="auth-points">
            <li><Check size={15} aria-hidden="true" />Repeat alerts join the open incident instead of paging twice</li>
            <li><Check size={15} aria-hidden="true" />Every responder sees changes live</li>
            <li><Check size={15} aria-hidden="true" />Roles and an audit log for every workspace</li>
          </ul>
        </div>
        <a className="demo-link" href="/demo">
          <span><b>Explore the demo workspace</b><small>No account needed. Sample data, fully clickable.</small></span>
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {invitation && (
            <div className="callout callout-info">
              <div><b>You’re invited to {invitation.organization_name}</b><p>Sign in or create an account as {invitation.email} to join as {invitation.role}.</p></div>
            </div>
          )}
          <h2>{mode === 'register' ? 'Create your workspace' : 'Sign in'}</h2>
          <p className="auth-switch">
            {mode === 'register' ? 'Already use Aegis? ' : 'New to Aegis? '}
            <button type="button" className="link" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError('') }}>
              {mode === 'register' ? 'Sign in' : 'Create a workspace'}
            </button>
          </p>
          <form className="form" onSubmit={submit}>
            {mode === 'register' && (
              <>
                <label className="field"><span>Your name</span><input autoComplete="name" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
                <label className="field"><span>Organization</span><input autoComplete="organization" required minLength={2} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} /></label>
              </>
            )}
            <label className="field"><span>Work email</span><input autoComplete="email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">
              <span>Password {mode === 'register' && <small>At least 8 characters</small>}</span>
              <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {server === 'waking' && <p className="hint" role="status"><Spinner /> Starting the server. On free hosting this can take up to a minute.</p>}
            {server === 'unreachable' && <p className="form-error" role="alert">The server isn’t responding. Try again shortly, or explore the demo workspace.</p>}
            <button className="button primary large" disabled={loading || server === 'waking'}>{loading && <Spinner />}{mode === 'register' ? 'Create workspace' : 'Sign in'}</button>
          </form>
        </div>
      </section>
    </div>
  )
}

export function InvitationAcceptance({ invitation, invitationToken, token, onAccepted, onLogout }: {
  invitation: InvitationPreview
  invitationToken: string
  token: string
  onAccepted: () => void
  onLogout: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function accept() {
    setBusy(true); setError('')
    try { await api.acceptInvitation(invitationToken, token); onAccepted() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <div className="center-page">
      <div className="auth-card">
        <Brand />
        <h2>Join {invitation.organization_name}</h2>
        <p className="muted-text">You were invited as {invitation.role === 'admin' ? 'an' : 'a'} {invitation.role}. The workspace is added to your account.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="stack-tight">
          <button type="button" className="button primary large" disabled={busy || invitation.accepted} onClick={accept}>{busy && <Spinner />}{invitation.accepted ? 'Already accepted' : 'Accept invitation'}</button>
          <button type="button" className="button large" onClick={onLogout}>Use a different account</button>
        </div>
      </div>
    </div>
  )
}
