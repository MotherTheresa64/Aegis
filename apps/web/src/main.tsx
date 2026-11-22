import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import App from './App'
import { applyTheme } from './lib/theme'
import { resolveShowcaseRoute } from './showcase-gate'

applyTheme()

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// A hosted build with no reachable API opens the demo workspace directly.
void resolveShowcaseRoute().finally(mount)
