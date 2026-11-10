import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './advanced.css'
import './polish.css'
import './showcase-design.css'
import './themes.css'
import './completion.css'
import './refinement.css'
import { initializeThemes } from './theme'
import AppV3 from './AppV3'
import { resolveShowcaseRoute } from './showcase-gate'

initializeThemes()

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppV3 />
    </StrictMode>,
  )
}

// A hosted build with no reachable API opens the read-only demo directly.
void resolveShowcaseRoute().finally(mount)
