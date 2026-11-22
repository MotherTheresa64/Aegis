import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

import { Dialog } from './Dialog'

type Tone = 'success' | 'error'
interface Toast { id: number; message: string; tone: Tone }
interface ConfirmOptions { title: string; body: string; confirmLabel: string; destructive?: boolean }

interface FeedbackValue {
  toast: (message: string, tone?: Tone) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackValue>({
  toast: () => undefined,
  confirm: async () => false,
})

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(value: boolean) => void>(() => undefined)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((items) => items.filter((item) => item.id !== id)), [])
  const toast = useCallback((message: string, tone: Tone = 'success') => {
    const id = nextId.current++
    setToasts((items) => [...items.slice(-2), { id, message, tone }])
    window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3500)
  }, [dismiss])
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve
    setPendingConfirm(options)
  }), [])
  const settle = (value: boolean) => { resolver.current(value); setPendingConfirm(null) }
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
            {item.tone === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            <span>{item.message}</span>
            <button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={14} /></button>
          </div>
        ))}
      </div>
      <Dialog open={pendingConfirm !== null} title={pendingConfirm?.title ?? ''} size="sm" onClose={() => settle(false)}>
        <p className="dialog-text">{pendingConfirm?.body}</p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => settle(false)}>Cancel</button>
          <button type="button" className={`button ${pendingConfirm?.destructive ? 'danger' : 'primary'}`} onClick={() => settle(true)} autoFocus>
            {pendingConfirm?.confirmLabel}
          </button>
        </div>
      </Dialog>
    </FeedbackContext.Provider>
  )
}

export const useFeedback = () => useContext(FeedbackContext)
