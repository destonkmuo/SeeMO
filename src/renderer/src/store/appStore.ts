import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { noteFileBase, titleFromFileName, uniqueFileName } from '../notes'

export type NavKey = 'home' | 'todo' | 'calendar' | 'agent' | 'activity' | 'misc' | 'settings'

/** Visual/behavioral state of the core orb. */
export type CoreState = 'sleep' | 'idle' | 'working' | 'speaking'

export interface Note {
  id: string
  title: string
  content: string
  /** File inside the vault, e.g. `my-note.md`. Assigned on creation/import. */
  fileName: string
  createdAt: number
  updatedAt: number
}

/**
 * An open tab. Notes are many-per-app; every nav destination is a singleton
 * (opening it again just focuses the existing tab).
 */
export type Tab = { id: string; kind: 'note'; noteId: string } | { id: string; kind: NavKey }

interface AppState {
  coreState: CoreState
  notes: Note[]
  tabs: Tab[]
  activeTabId: string | null
  query: string
  vaultPath: string | null
  vaultReady: boolean
  vaultError: string | null
  setCoreState: (state: CoreState) => void
  setQuery: (query: string) => void
  setActiveTab: (id: string) => void
  openNav: (kind: NavKey) => void
  openNote: (noteId: string) => void
  closeTab: (id: string) => void
  createNote: () => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'content'>>) => void
  deleteNote: (id: string) => void
  initVault: (force?: boolean) => Promise<void>
  refreshVault: () => Promise<void>
  saveNoteToVault: (id: string) => Promise<void>
  chooseVault: () => Promise<string | null>
}

function uid(): string {
  return crypto.randomUUID()
}

function navTab(kind: NavKey): Tab {
  return { id: uid(), kind }
}

function noteTab(noteId: string): Tab {
  return { id: uid(), kind: 'note', noteId }
}

function blankNote(): Note {
  const now = Date.now()
  return { id: uid(), title: '', content: '', fileName: '', createdAt: now, updatedAt: now }
}

const initialTab = navTab('home')

/** Guard so StrictMode double-mounts and manual refreshes share one load. */
let vaultInitPromise: Promise<void> | null = null

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // The mic pipeline is always listening, so the core starts attentive.
      coreState: 'idle',
      notes: [],
      tabs: [initialTab],
      activeTabId: initialTab.id,
      query: '',
      vaultPath: null,
      vaultReady: false,
      vaultError: null,
      setCoreState: (coreState) => set({ coreState }),
      setQuery: (query) => set({ query }),
      setActiveTab: (id) => set({ activeTabId: id }),
      openNav: (kind) =>
        set((state) => {
          const existing = state.tabs.find((t) => t.kind === kind)
          if (existing) return { activeTabId: existing.id }
          const tab = navTab(kind)
          return { tabs: [...state.tabs, tab], activeTabId: tab.id }
        }),
      openNote: (noteId) =>
        set((state) => {
          const existing = state.tabs.find((t) => t.kind === 'note' && t.noteId === noteId)
          if (existing) return { activeTabId: existing.id }
          const tab = noteTab(noteId)
          return { tabs: [...state.tabs, tab], activeTabId: tab.id }
        }),
      closeTab: (id) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => t.id === id)
          if (index < 0) return {}
          const tabs = state.tabs.filter((t) => t.id !== id)
          const activeTabId =
            state.activeTabId === id
              ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null)
              : state.activeTabId
          return { tabs, activeTabId }
        }),
      createNote: () => {
        const note = blankNote()
        const tab = noteTab(note.id)
        set((state) => {
          const taken = new Set(state.notes.map((n) => n.fileName))
          const fileName = uniqueFileName(noteFileBase(note.title), taken)
          return {
            notes: [{ ...note, fileName }, ...state.notes],
            tabs: [...state.tabs, tab],
            activeTabId: tab.id
          }
        })
        const created = get().notes.find((n) => n.id === note.id)
        if (created && get().vaultReady) {
          void window.api.vault.write(created.fileName, created.content).catch((error) => {
            console.error(`[vault] failed to write ${created.fileName}`, error)
            set({ vaultError: `Could not write ${created.fileName}.` })
          })
        }
        return note.id
      },
      updateNote: (id, patch) =>
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
          )
        })),
      deleteNote: (id) => {
        const removed = get().notes.find((n) => n.id === id)
        const removeFile = Boolean(removed?.fileName && get().vaultReady)
        set((state) => {
          const notes = state.notes.filter((n) => n.id !== id)
          const tabs = state.tabs.filter((t) => !(t.kind === 'note' && t.noteId === id))
          const activeTabId = tabs.some((t) => t.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[0]?.id ?? null)
          return { notes, tabs, activeTabId }
        })
        if (removeFile && removed) {
          void window.api.vault.remove(removed.fileName).catch((error) => {
            console.error(`[vault] failed to remove ${removed.fileName}`, error)
          })
        }
      },
      initVault: (force = false) => {
        if (vaultInitPromise && !force) return vaultInitPromise
        if (force) vaultInitPromise = null
        vaultInitPromise = (async () => {
          set({ vaultError: null })
          try {
            const { root } = await window.api.vault.status()
            set({ vaultPath: root })
            const files = await window.api.vault.list()
            const disk: {
              fileName: string
              content: string
              mtimeMs: number
              birthtimeMs: number
            }[] = []
            for (const file of files) {
              try {
                const read = await window.api.vault.read(file.name)
                disk.push({
                  fileName: file.name,
                  content: read.content,
                  mtimeMs: read.mtimeMs,
                  birthtimeMs: file.birthtimeMs
                })
              } catch (error) {
                console.error(`[vault] failed to read ${file.name}`, error)
              }
            }

            const pendingWrites: { id: string; fileName: string }[] = []
            set((state) => {
              const storedByFile = new Map(state.notes.map((note) => [note.fileName, note]))
              const taken = new Set<string>()
              const notes: Note[] = []
              // Disk is the source of truth for files that exist there.
              for (const entry of disk) {
                const existing = storedByFile.get(entry.fileName)
                if (existing) {
                  notes.push({
                    ...existing,
                    content: entry.content,
                    updatedAt: Math.max(existing.updatedAt, Math.round(entry.mtimeMs))
                  })
                } else {
                  notes.push({
                    id: crypto.randomUUID(),
                    title: titleFromFileName(entry.fileName),
                    content: entry.content,
                    fileName: entry.fileName,
                    createdAt: Math.round(entry.birthtimeMs) || Date.now(),
                    updatedAt: Math.round(entry.mtimeMs) || Date.now()
                  })
                }
                taken.add(entry.fileName)
              }
              // Notes missing on disk (new, or pre-vault) get written out.
              for (const note of state.notes) {
                if (disk.some((entry) => entry.fileName === note.fileName)) continue
                const fileName = uniqueFileName(note.fileName || noteFileBase(note.title), taken)
                taken.add(fileName)
                notes.push(fileName === note.fileName ? note : { ...note, fileName })
                pendingWrites.push({ id: note.id, fileName })
              }
              const noteIds = new Set(notes.map((n) => n.id))
              const tabs = state.tabs.filter(
                (tab) => tab.kind !== 'note' || noteIds.has(tab.noteId)
              )
              const withTabs = tabs.length > 0 ? tabs : [navTab('home')]
              const activeTabId = withTabs.some((t) => t.id === state.activeTabId)
                ? state.activeTabId
                : withTabs[0].id
              return { notes, tabs: withTabs, activeTabId }
            })

            for (const pending of pendingWrites) {
              try {
                const note = get().notes.find((n) => n.id === pending.id)
                if (!note) continue
                const written = await window.api.vault.write(pending.fileName, note.content)
                if (written.name !== pending.fileName) {
                  set((state) => ({
                    notes: state.notes.map((n) =>
                      n.id === pending.id ? { ...n, fileName: written.name } : n
                    )
                  }))
                }
              } catch (error) {
                console.error(`[vault] failed to write ${pending.fileName}`, error)
                set({ vaultError: `Could not write ${pending.fileName}.` })
              }
            }
            set({ vaultReady: true })
          } catch (error) {
            console.error('[vault] initialization failed', error)
            set({ vaultError: 'Could not open the notes vault.', vaultReady: false })
          }
        })()
        return vaultInitPromise
      },
      refreshVault: () => get().initVault(true),
      saveNoteToVault: async (id) => {
        const state = get()
        if (!state.vaultReady) return
        const note = state.notes.find((n) => n.id === id)
        if (!note) return
        try {
          const taken = new Set(state.notes.filter((n) => n.id !== id).map((n) => n.fileName))
          let fileName = note.fileName || uniqueFileName(noteFileBase(note.title), taken)
          if (note.fileName && fileName !== note.fileName) {
            const renamed = await window.api.vault.rename(note.fileName, fileName)
            fileName = renamed.name
            set((s) => ({
              notes: s.notes.map((n) => (n.id === id ? { ...n, fileName } : n))
            }))
          } else if (!note.fileName) {
            set((s) => ({
              notes: s.notes.map((n) => (n.id === id ? { ...n, fileName } : n))
            }))
          }
          const current = get().notes.find((n) => n.id === id)
          if (!current) return
          const written = await window.api.vault.write(fileName, current.content)
          if (written.name !== fileName) {
            set((s) => ({
              notes: s.notes.map((n) => (n.id === id ? { ...n, fileName: written.name } : n))
            }))
          }
        } catch (error) {
          console.error(`[vault] failed to save note ${id}`, error)
          set({ vaultError: 'Could not save the note to the vault.' })
        }
      },
      chooseVault: async () => {
        try {
          const result = await window.api.vault.choose()
          if (!result) return null
          await get().initVault(true)
          return result.root
        } catch (error) {
          console.error('[vault] failed to change folder', error)
          set({ vaultError: 'Could not change the vault folder.' })
          return null
        }
      }
    }),
    {
      name: 'seemo-store',
      // Only documents and open tabs are worth persisting; UI state resets.
      partialize: (state) => ({
        notes: state.notes,
        tabs: state.tabs,
        activeTabId: state.activeTabId
      }),
      // Drop note tabs whose note no longer exists (e.g. after an older
      // session) and always leave at least one tab open.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<AppState, 'notes' | 'tabs' | 'activeTabId'>>
        const notes = saved.notes ?? []
        const noteIds = new Set(notes.map((n) => n.id))
        const restored = (saved.tabs ?? []).filter(
          (tab) => tab.kind !== 'note' || noteIds.has(tab.noteId)
        )
        const tabs = restored.length > 0 ? restored : [navTab('home')]
        const activeTabId = tabs.some((t) => t.id === saved.activeTabId)
          ? (saved.activeTabId as string)
          : tabs[0].id
        return { ...current, notes, tabs, activeTabId }
      }
    }
  )
)
