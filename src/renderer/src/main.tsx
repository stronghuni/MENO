import './styles/tokens.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Flag the Electron renderer so CSS can opt into vibrancy-aware styles.
// Without this, a browser preview without vibrancy material would show the
// transparent sidebar against a stark white body and lose the active-card
// contrast that vibrancy normally provides.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (w.electron || w.api) {
    document.documentElement.classList.add('is-electron')
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
