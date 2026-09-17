import { ElectronAPI } from '@electron-toolkit/preload'
import type { GithubApi } from './github'
import type { VaultApi } from './vault'

interface VoiceApi {
  onVoiceTranscript: (callback: (text: string) => void) => () => void
  speak: (text: string) => Promise<boolean>
}

interface AppApi extends VoiceApi {
  vault: VaultApi
  github: GithubApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppApi
  }
}
