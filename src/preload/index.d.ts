import { ElectronAPI } from '@electron-toolkit/preload'
import type { GithubApi } from './github'
import type { VaultApi } from './vault'

interface VoiceApi {
  onVoiceTranscript: (callback: (text: string) => void) => () => void
  onVoiceWake: (callback: () => void) => () => void
  speak: (text: string) => Promise<boolean>
  importAlarmSound: () => Promise<{ name: string; url: string } | null>
  fetchIcs: (url: string) => Promise<string>
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
