import { create } from 'zustand'

export type NavKey = 'todo' | 'calendar' | 'agent' | 'activity' | 'misc'

interface AppState {
  active: NavKey
  speaking: boolean
  setActive: (key: NavKey) => void
  setSpeaking: (speaking: boolean) => void
  toggleSpeaking: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  active: 'agent',
  speaking: false,
  setActive: (key) => set({ active: key }),
  setSpeaking: (speaking) => set({ speaking }),
  toggleSpeaking: () => set((state) => ({ speaking: !state.speaking }))
}))
