import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './advanced.css'
import './polish.css'
import './showcase-design.css'
import './themes.css'
import './completion.css'
import { initializeThemes } from './theme'
import AppV3 from './AppV3'

initializeThemes()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV3 />
  </StrictMode>,
)
