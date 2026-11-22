import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export function PageHeader({ title, description, actions, back }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <header className="page-header">
      {back}
      <div className="page-header-row">
        <div className="page-title">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  )
}

export function Panel({ title, description, actions, children, className = '' }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><Loader2 className="spin" size={18} aria-hidden="true" /><span>{label}</span></div>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <b>This view didn’t load</b>
      <p>{message}</p>
      {retry && <button type="button" className="button" onClick={retry}>Try again</button>}
    </div>
  )
}

export function Spinner() {
  return <Loader2 className="spin" size={15} aria-hidden="true" />
}
