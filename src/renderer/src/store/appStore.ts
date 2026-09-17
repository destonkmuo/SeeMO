import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { noteFileBase, orderedNotes, titleFromFileName, uniqueFileName } from '../notes'

export type NavKey =
  'home' | 'graph' | 'todo' | 'calendar' | 'agent' | 'activity' | 'misc' | 'settings'

/** Visual/behavioral state of the core orb. */
export type CoreState = 'sleep' | 'idle' | 'working' | 'speaking' | 'summoned'

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

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: number
}

/** Cap persisted history so the store stays small. */
const MAX_CHAT_MESSAGES = 100

/** Sidebar resize bounds (px). Shared by the store default and the drag handle. */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 260

export function clampSidebarWidth(width: unknown): number {
  if (typeof width !== 'number' || Number.isNaN(width)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

/** Split-view ratio bounds (fraction of content width given to the left pane). */
export const SPLIT_RATIO_MIN = 0.15
export const SPLIT_RATIO_MAX = 0.85
export const SPLIT_RATIO_DEFAULT = 0.5

export function clampSplitRatio(ratio: unknown): number {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) return SPLIT_RATIO_DEFAULT
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio))
}

interface AppState {
  coreState: CoreState
  notes: Note[]
  /** Manual sidebar order (note ids). Missing ids render first, by recency. */
  noteOrder: string[]
  tabs: Tab[]
  activeTabId: string | null
  query: string
  vaultPath: string | null
  vaultReady: boolean
  vaultError: string | null
  messages: ChatMessage[]
  autoSync: boolean
  backgroundListening: boolean
  lastSeenAgentId: string | null
  ttsEnabled: boolean
  sidebarWidth: number
  /** Tab pinned in the right split pane; null = no split. */
  splitTabId: string | null
  /** Left-pane share of split-view width, 0..1. */
  splitRatio: number
  setCoreState: (state: CoreState) => void
  setAutoSync: (enabled: boolean) => void
  setBackgroundListening: (enabled: boolean) => void
  setTtsEnabled: (enabled: boolean) => void
  setSidebarWidth: (width: number) => void
  setSplitTab: (id: string | null) => void
  setSplitRatio: (ratio: number) => void
  markAgentSeen: () => void
  setQuery: (query: string) => void
  setActiveTab: (id: string) => void
  openNav: (kind: NavKey) => void
  openNote: (noteId: string) => void
  closeTab: (id: string) => void
  closeAllTabs: () => void
  moveTab: (dragId: string, targetId: string | null, before: boolean) => void
  moveNote: (dragId: string, targetId: string | null, before: boolean) => void
  createNote: (title?: string) => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'content'>>) => void
  deleteNote: (id: string) => void
  initVault: (force?: boolean) => Promise<void>
  refreshVault: () => Promise<void>
  saveNoteToVault: (id: string) => Promise<void>
  chooseVault: () => Promise<string | null>
  addChatMessage: (role: ChatMessage['role'], text: string) => string
  updateChatMessage: (id: string, text: string) => void
  clearChat: () => void
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
      noteOrder: [],
      tabs: [initialTab],
      activeTabId: initialTab.id,
      query: '',
      vaultPath: null,
      vaultReady: false,
      vaultError: null,
      messages: [],
      autoSync: false,
      backgroundListening: false,
      lastSeenAgentId: null,
      ttsEnabled: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      splitTabId: null,
      splitRatio: SPLIT_RATIO_DEFAULT,
      setCoreState: (coreState) => set({ coreState }),
      setAutoSync: (autoSync) => set({ autoSync }),
      setBackgroundListening: (backgroundListening) => set({ backgroundListening }),
      setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
      setSplitTab: (splitTabId) => set({ splitTabId }),
      setSplitRatio: (splitRatio) => set({ splitRatio: clampSplitRatio(splitRatio) }),
      markAgentSeen: () =>
        set((state) => {
          let latest: string | null = null
          for (const message of state.messages) {
            if (message.role === 'agent') latest = message.id
          }
          return latest ? { lastSeenAgentId: latest } : {}
        }),
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
          // Closing the split tab itself dissolves the split.
          const splitTabId = state.splitTabId === id ? null : state.splitTabId
          return { tabs, activeTabId, splitTabId }
        }),
      closeAllTabs: () => set({ tabs: [], activeTabId: null, splitTabId: null }),
      moveTab: (dragId, targetId, before) =>
        set((state) => {
          if (dragId === targetId) return {}
          const from = state.tabs.findIndex((t) => t.id === dragId)
          if (from < 0) return {}
          const dragged = state.tabs[from]
          const without = state.tabs.filter((t) => t.id !== dragId)
          // Dropped on empty bar space (or a stale target): pin to the end.
          if (!targetId) return { tabs: [...without, dragged] }
          let to = without.findIndex((t) => t.id === targetId)
          if (to < 0) return { tabs: [...without, dragged] }
          if (!before) to += 1
          return { tabs: [...without.slice(0, to), dragged, ...without.slice(to)] }
        }),
      moveNote: (dragId, targetId, before) =>
        set((state) => {
          if (dragId === targetId) return {}
          // Canonical full order first, so a partial/stale noteOrder heals
          // itself instead of dropping notes.
          const full = orderedNotes(state.notes, state.noteOrder).map((n) => n.id)
          if (!full.includes(dragId)) return {}
          const without = full.filter((id) => id !== dragId)
          // Dropped on empty list space (or a stale target): pin to the end.
          if (!targetId) return { noteOrder: [...without, dragId] }
          let to = without.indexOf(targetId)
          if (to < 0) return { noteOrder: [...without, dragId] }
          if (!before) to += 1
          return { noteOrder: [...without.slice(0, to), dragId, ...without.slice(to)] }
        }),
      createNote: (title?: string) => {
        const note = { ...blankNote(), title: (title ?? '').trim() }
        const tab = noteTab(note.id)
        set((state) => {
          const taken = new Set(state.notes.map((n) => n.fileName))
          const fileName = uniqueFileName(noteFileBase(note.title), taken)
          return {
            notes: [{ ...note, fileName }, ...state.notes],
            noteOrder: [note.id, ...state.noteOrder.filter((id) => id !== note.id)],
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
          const noteOrder = state.noteOrder.filter((noteId) => noteId !== id)
          const tabs = state.tabs.filter((t) => !(t.kind === 'note' && t.noteId === id))
          const activeTabId = tabs.some((t) => t.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[0]?.id ?? null)
          const splitTabId =
            state.splitTabId && tabs.some((t) => t.id === state.splitTabId)
              ? state.splitTabId
              : null
          return { notes, noteOrder, tabs, activeTabId, splitTabId }
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
              // Keep the manual order, drop stale ids, surface unpositioned
              // notes (imports, pre-vault notes) up top by recency.
              const keptOrder = state.noteOrder.filter((id) => noteIds.has(id))
              const keptSet = new Set(keptOrder)
              const unpositioned = notes
                .filter((n) => !keptSet.has(n.id))
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((n) => n.id)
              return {
                notes,
                noteOrder: [...unpositioned, ...keptOrder],
                tabs: withTabs,
                activeTabId
              }
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
      },
      addChatMessage: (role, text) => {
        const message: ChatMessage = { id: uid(), role, text, timestamp: Date.now() }
        set((state) => ({ messages: [...state.messages, message].slice(-MAX_CHAT_MESSAGES) }))
        return message.id
      },
      updateChatMessage: (id, text) =>
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, text } : m))
        })),
      clearChat: () => set({ messages: [] })
    }),
    {
      name: 'seemo-store',
      // Only documents, open tabs, sidebar order and chat history persist.
      partialize: (state) => ({
        notes: state.notes,
        noteOrder: state.noteOrder,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        messages: state.messages.slice(-MAX_CHAT_MESSAGES),
        autoSync: state.autoSync,
        backgroundListening: state.backgroundListening,
        lastSeenAgentId: state.lastSeenAgentId,
        ttsEnabled: state.ttsEnabled,
        sidebarWidth: state.sidebarWidth,
        splitTabId: state.splitTabId,
        splitRatio: state.splitRatio
      }),
      // Drop note tabs whose note no longer exists (e.g. after an older
      // session) and always leave at least one tab open.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<
            AppState,
            | 'notes'
            | 'noteOrder'
            | 'tabs'
            | 'activeTabId'
            | 'messages'
            | 'autoSync'
            | 'backgroundListening'
            | 'lastSeenAgentId'
            | 'ttsEnabled'
            | 'sidebarWidth'
            | 'splitTabId'
            | 'splitRatio'
          >
        >
        const notes = saved.notes ?? []
        const noteIds = new Set(notes.map((n) => n.id))
        const restored = (saved.tabs ?? []).filter(
          (tab) => tab.kind !== 'note' || noteIds.has(tab.noteId)
        )
        const tabs = restored.length > 0 ? restored : [navTab('home')]
        const activeTabId = tabs.some((t) => t.id === saved.activeTabId)
          ? (saved.activeTabId as string)
          : tabs[0].id
        const messages = (saved.messages ?? []).slice(-MAX_CHAT_MESSAGES)
        const noteOrder = (saved.noteOrder ?? []).filter((id) => noteIds.has(id))
        // Never pop the bubble for history that predates this launch: seed
        // "seen" at the newest restored agent message.
        let lastSeenAgentId = saved.lastSeenAgentId ?? null
        if (!lastSeenAgentId) {
          for (const message of messages) {
            if (message.role === 'agent') lastSeenAgentId = message.id
          }
        }
        return {
          ...current,
          notes,
          noteOrder,
          tabs,
          activeTabId,
          messages,
          autoSync: saved.autoSync ?? false,
          backgroundListening: saved.backgroundListening ?? false,
          ttsEnabled: saved.ttsEnabled ?? true,
          sidebarWidth: clampSidebarWidth(saved.sidebarWidth),
          splitTabId:
            saved.splitTabId && tabs.some((t) => t.id === saved.splitTabId)
              ? saved.splitTabId
              : null,
          splitRatio: clampSplitRatio(saved.splitRatio),
          lastSeenAgentId
        }
      }
    }
  )
)
