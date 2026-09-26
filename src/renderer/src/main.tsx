import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OrbView from './components/OrbView'
import { VoiceProvider } from './context/VoiceContext'

// Platform hook for OS-specific chrome: macOS floats traffic lights over the
// sidebar (needs clearance); Windows/Linux use a native frame (don't).
if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')) {
  document.documentElement.classList.add('is-mac')
}

// The PiP orb window loads the same bundle with ?orb=1: it renders only the
// live core (no providers — chat/agent side effects stay in the main window).
const isOrb = new URLSearchParams(window.location.search).get('orb') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOrb ? (
      <OrbView />
    ) : (
      <VoiceProvider>
        <App />
      </VoiceProvider>
    )}
  </StrictMode>
)
