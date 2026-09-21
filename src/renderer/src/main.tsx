import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OrbView from './components/OrbView'
import { VoiceProvider } from './context/VoiceContext'

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
