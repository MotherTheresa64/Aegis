import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api'
import { useFeedback } from './Feedback'

/** Called when the API says "forbidden": the user's role probably changed under them. */
const ForbiddenContext = createContext<() => void>(() => undefined)
export const ForbiddenProvider = ForbiddenContext.Provider

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  return error instanceof ApiError || error instanceof Error ? error.message || fallback : fallback
}

/** Loads data whenever `key` changes; `key` must encode every input the loader reads. */
export function useResource<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const loader = useRef(load)
  loader.current = load
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    // Only the newest request may write state; older replies can arrive later.
    const request = ++sequence.current
    try {
      const next = await loader.current()
      if (request !== sequence.current) return
      setData(next)
      setError('')
    } catch (err) {
      if (request !== sequence.current) return
      setError(errorMessage(err, 'Could not load this data.'))
    } finally {
      if (request === sequence.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [key, reload])

  return { data, error, loaded, reload, setData }
}

/** Tracks one in-flight mutation per component and reports failures as toasts. */
export function useAction() {
  const { toast } = useFeedback()
  const onForbidden = useContext(ForbiddenContext)
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setPending(key)
    try {
      const result = await action()
      if (success) toast(success, 'success')
      return result
    } catch (err) {
      toast(errorMessage(err), 'error')
      if (err instanceof ApiError && err.status === 403) onForbidden()
      return undefined
    } finally {
      setPending(null)
    }
  }, [toast, onForbidden])
  return { pending, run }
}
