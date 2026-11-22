import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
const KEY = 'aegis-theme'

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(preference: ThemePreference = read()) {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
}

export function useTheme(): [ThemePreference, (value: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(read)
  useEffect(() => {
    applyTheme(preference)
    try {
      if (preference === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, preference)
    } catch {
      // Preference still applies for this page view.
    }
  }, [preference])
  return [preference, setPreference]
}
