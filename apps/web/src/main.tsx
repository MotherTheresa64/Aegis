import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './advanced.css'
import './polish.css'
import AppV3 from './AppV3'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppV3 />
  </StrictMode>,
)
