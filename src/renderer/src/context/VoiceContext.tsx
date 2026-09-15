/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface VoiceTranscript {
  id: string
  text: string
  timestamp: number
}

interface VoiceContextValue {
  transcripts: VoiceTranscript[]
  lastTranscript: VoiceTranscript | null
  clear: () => void
  dump: () => void
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

interface VoiceContextGlobal {
  transcripts: VoiceTranscript[]
  dump: () => void
  clear: () => void
}

declare global {
  interface Window {
    __voiceContext?: VoiceContextGlobal
  }
}

/**
 * Global context for the whisper pipeline output.
 *
 * The main process runs the Python whisper pipeline and forwards each finished
 * transcription over IPC. This provider collects them, mirrors the whole
 * context onto `window.__voiceContext`, and prints the contents to the DevTools
 * console on every update.
 */
export function VoiceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([])

  // Receive transcriptions forwarded from the main process.
  useEffect(() => {
    return window.api.onVoiceTranscript((text) => {
      setTranscripts((prev) => [...prev, { id: crypto.randomUUID(), text, timestamp: Date.now() }])
    })
  }, [])

  const clear = useCallback((): void => setTranscripts([]), [])

  const dump = useCallback((): void => {
    // Copy-pasteable snapshot of the context contents.
    console.log('[VoiceContext] contents:\n' + JSON.stringify(transcripts, null, 2))
  }, [transcripts])

  // Mirror the context on `window` and log every update to the DevTools console.
  useEffect(() => {
    window.__voiceContext = { transcripts, dump, clear }

    if (transcripts.length > 0) {
      console.log('[VoiceContext] transcript:', transcripts[transcripts.length - 1].text)
      console.log('[VoiceContext] contents:', transcripts)
    }
  }, [transcripts, dump, clear])

  useEffect(() => {
    console.log(
      '[VoiceContext] ready — inspect with `__voiceContext.transcripts` or call `__voiceContext.dump()`'
    )
  }, [])

  const value: VoiceContextValue = {
    transcripts,
    lastTranscript: transcripts.length > 0 ? transcripts[transcripts.length - 1] : null,
    clear,
    dump
  }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider')
  }
  return context
}
