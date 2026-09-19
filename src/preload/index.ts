import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { GithubApi } from './github'
import type { VaultApi } from './vault'

// Custom APIs for renderer
const vault: VaultApi = {
  status: () => ipcRenderer.invoke('vault:status'),
  choose: () => ipcRenderer.invoke('vault:choose'),
  reveal: () => ipcRenderer.invoke('vault:reveal'),
  list: () => ipcRenderer.invoke('vault:list'),
  read: (name: string) => ipcRenderer.invoke('vault:read', name),
  write: (name: string, content: string) => ipcRenderer.invoke('vault:write', name, content),
  rename: (oldName: string, newName: string) =>
    ipcRenderer.invoke('vault:rename', oldName, newName),
  remove: (name: string) => ipcRenderer.invoke('vault:remove', name),
  readJson: (name: string) => ipcRenderer.invoke('vault:readJson', name),
  writeJson: (name: string, data: unknown[]) => ipcRenderer.invoke('vault:writeJson', name, data),
  importPicture: (sourcePath?: string) => ipcRenderer.invoke('vault:importPicture', sourcePath),
  importPictureData: (name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('vault:importPictureData', name, data)
}

const api = {
  onVoiceTranscript: (callback: (text: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on('voice:transcript', listener)
    return () => {
      ipcRenderer.removeListener('voice:transcript', listener)
    }
  },
  onVoiceWake: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('voice:wake', listener)
    return () => {
      ipcRenderer.removeListener('voice:wake', listener)
    }
  },
  vault,
  speak: (text: string): Promise<boolean> => ipcRenderer.invoke('voice:speak', text),
  importAlarmSound: (): Promise<{ name: string; url: string } | null> =>
    ipcRenderer.invoke('alarm:importSound'),
  fetchIcs: (url: string): Promise<string> => ipcRenderer.invoke('calendar:fetchIcs', url),
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    createRepo: (name: string, isPrivate: boolean) =>
      ipcRenderer.invoke('github:create', name, isPrivate),
    sync: (message?: string) => ipcRenderer.invoke('github:sync', message),
    disconnect: () => ipcRenderer.invoke('github:disconnect')
  } satisfies GithubApi
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
