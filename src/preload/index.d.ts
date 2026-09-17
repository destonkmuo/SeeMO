import { ElectronAPI } from '@electron-toolkit/preload'
import type { VaultApi } from './vault'

interface VoiceApi {
  onVoiceTranscript: (callback: (text: string) => void) => () => void
}

interface AppApi extends VoiceApi {
  vault: VaultApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
