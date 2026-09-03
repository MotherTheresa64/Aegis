type ThemeId = 'aegis' | 'sentinel' | 'nightwatch' | 'graphite'

const STORAGE_KEY = 'aegis-theme-v1'
const themes: Array<{ id: ThemeId; label: string; description: string; colors: [string, string] }> = [
  { id: 'aegis', label: 'Aegis', description: 'Signature ultraviolet and threat lime', colors: ['#080611', '#a75cff'] },
  { id: 'sentinel', label: 'Sentinel', description: 'Near-black with cool cyan signals', colors: ['#050a0f', '#45d7d1'] },
  { id: 'nightwatch', label: 'Nightwatch', description: 'Deep navy with electric blue', colors: ['#050812', '#5e8cff'] },
  { id: 'graphite', label: 'Graphite', description: 'Low-glare charcoal and silver', colors: ['#08090c', '#9aa8ba'] },
]

function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null
    return themes.some((theme) => theme.id === saved) ? saved! : 'aegis'
  } catch { return 'aegis' }
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = 'dark'
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* Theme remains available in memory. */ }
  document.querySelectorAll<HTMLButtonElement>('[data-aegis-theme]').forEach((button) => {
    const selected = button.dataset.aegisTheme === theme
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
}

function createThemeControl() {
  if (document.querySelector('.aegis-theme-control')) return
  const host = document.createElement('div')
  host.className = 'aegis-theme-control'
  host.innerHTML = `<button class="aegis-theme-trigger" type="button" aria-label="Change Aegis theme" aria-expanded="false">◐<span>Theme</span></button><div class="aegis-theme-panel" role="dialog" aria-label="Choose Aegis theme" hidden><header><div><b>Appearance</b><small>Every option uses a dark, low-glare foundation.</small></div><button type="button" aria-label="Close theme picker">×</button></header><div class="aegis-theme-options"></div></div>`
  const trigger = host.querySelector<HTMLButtonElement>('.aegis-theme-trigger')!
  const panel = host.querySelector<HTMLElement>('.aegis-theme-panel')!
  const closeButton = panel.querySelector<HTMLButtonElement>('header button')!
  const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false') }
  themes.forEach((theme) => {
    const button = document.createElement('button')
    button.type = 'button'; button.dataset.aegisTheme = theme.id
    button.innerHTML = `<i style="--a:${theme.colors[0]};--b:${theme.colors[1]}"></i><span><b>${theme.label}</b><small>${theme.description}</small></span><em>✓</em>`
    button.addEventListener('click', () => { applyTheme(theme.id); close() })
    host.querySelector('.aegis-theme-options')!.append(button)
  })
  trigger.addEventListener('click', () => { panel.hidden = !panel.hidden; trigger.setAttribute('aria-expanded', String(!panel.hidden)) })
  closeButton.addEventListener('click', close)
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close() })
  document.addEventListener('pointerdown', (event) => { if (!host.contains(event.target as Node)) close() })
  document.body.append(host)
  applyTheme(readTheme())
}

export function initializeThemes() {
  applyTheme(readTheme())
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createThemeControl, { once: true })
  else queueMicrotask(createThemeControl)
}
