import { ElectronAPI } from '@electron-toolkit/preload'

interface VoiceApi {
  onVoiceTranscript: (callback: (text: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: VoiceApi
  }
}
