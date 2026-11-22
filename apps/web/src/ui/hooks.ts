import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../api'
import { useFeedback } from './Feedback'

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  return error instanceof ApiError || error instanceof Error ? error.message || fallback : fallback
}

/** Loads data whenever `key` changes; `key` must encode every input the loader reads. */
export function useResource<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const loader = useRef(load)
  loader.current = load

  const reload = useCallback(async () => {
    try {
      setData(await loader.current())
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load this data.'))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [key, reload])

  return { data, error, reload, setData }
}

/** Tracks one in-flight mutation per component and reports failures as toasts. */
export function useAction() {
  const { toast } = useFeedback()
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setPending(key)
    try {
      const result = await action()
      if (success) toast(success, 'success')
      return result
    } catch (err) {
      toast(errorMessage(err), 'error')
      return undefined
    } finally {
      setPending(null)
    }
  }, [toast])
  return { pending, run }
}
