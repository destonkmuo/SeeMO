import { create } from 'zustand'

export type NavKey = 'todo' | 'calendar' | 'agent' | 'activity' | 'misc'

/** Visual/behavioral state of the core orb. */
export type CoreState = 'sleep' | 'idle' | 'working' | 'speaking'

interface AppState {
  active: NavKey
  coreState: CoreState
  setActive: (key: NavKey) => void
  setCoreState: (state: CoreState) => void
}

export const useAppStore = create<AppState>()((set) => ({
  active: 'agent',
  // The mic pipeline is always listening, so the core starts attentive.
  coreState: 'idle',
  setActive: (key) => set({ active: key }),
  setCoreState: (coreState) => set({ coreState })
}))
