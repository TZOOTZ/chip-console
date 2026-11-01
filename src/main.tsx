import '@fontsource/press-start-2p/latin-400.css'
import '@fontsource/vt323/latin-400.css'
import '@fontsource/space-mono/latin-400.css'
import '@fontsource/space-mono/latin-700.css'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: solo en producción (offline + instalación como app)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* sin SW la app funciona igual */
    })
  })
}
