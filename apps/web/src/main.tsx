import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppV2 from './AppV2'
import './styles.css'
import './themes.css'
import { initializeThemes } from './theme'

initializeThemes()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV2 />
  </StrictMode>,
)
