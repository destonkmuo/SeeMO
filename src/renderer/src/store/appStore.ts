import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { noteFileBase, orderedNotes, titleFromFileName, uniqueFileName } from '../notes'
import { parseIcs } from '../ical'
import {
  CALENDARS_FILE,
  CALENDAR_COLORS,
  CALENDAR_FILE,
  TASKS_FILE,
  TODO_FILE,
  calendarItemFromDraft,
  draftFromItem,
  parseCalendarData,
  parseSubscriptions,
  parseTaskItems,
  todayISO,
  taskItemFromDraft,
  type CalendarDraft,
  type CalendarItem,
  type CalendarSubscription,
  type TaskDraft,
  type TaskItem
} from '../planner'

export type NavKey =
  'home' | 'graph' | 'tasks' | 'calendar' | 'agent' | 'activity' | 'misc' | 'email' | 'settings'

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
  /** Trash timestamp, or null/undefined while the note is live. */
  deletedAt: number | null
}

/** Trash auto-destroys notes 30 days after they were trashed. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

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

/** Calendar display mode. Kept transient (not persisted). */
export type CalendarView = 'month' | 'week' | 'day'

interface AppState {
  coreState: CoreState
  notes: Note[]
  /** Manual sidebar order (note ids). Missing ids render first, by recency. */
  noteOrder: string[]
  /** User-defined sidebar sections (dividers), in display order. */
  noteSections: NoteSection[]
  /** Favorite note ids (sidebar lens). Stale ids render nothing. */
  favorites: string[]
  /** Note awaiting an in-sidebar rename (set on creation, consumed once). */
  renamingNoteId: string | null
  /** noteId -> section id. Missing (or stale) entries render ungrouped. */
  noteSection: Record<string, string>
  tabs: Tab[]
  activeTabId: string | null
  /** Tab ids, most-recently-active first. Powers the Ctrl+Tab switcher order. */
  tabRecency: string[]
  /** Linear visit history + cursor. Back/Forward step through it browser-style. */
  tabHistory: string[]
  historyIndex: number
  /** Named, color-coded tab groups (top tab bar), in display order. */
  tabGroups: TabGroup[]
  /** tabId -> group id. Stale entries render ungrouped. */
  tabGroup: Record<string, string>
  /** Collapsed group ids hide their tabs until expanded. */
  collapsedTabGroups: string[]
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
  calendarView: CalendarView
  calendarCursor: string
  alarmTime: string | null
  alarmEnabled: boolean
  alarmSoundId: string
  customAlarm: { name: string; url: string } | null
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
  goBackTab: () => void
  goForwardTab: () => void
  setCalendarView: (view: CalendarView) => void
  setCalendarCursor: (date: string) => void
  openDay: (date: string) => void
  setAlarmTime: (time: string | null) => void
  setAlarmEnabled: (enabled: boolean) => void
  setAlarmSoundId: (id: string) => void
  setCustomAlarm: (custom: { name: string; url: string } | null) => void
  openNav: (kind: NavKey) => void
  openNote: (noteId: string) => void
  closeTab: (id: string) => void
  closeAllTabs: () => void
  moveTab: (dragId: string, targetId: string | null, before: boolean) => void
  moveNote: (dragId: string, targetId: string | null, before: boolean) => void
  createSection: (title?: string) => string
  renameSection: (id: string, title: string) => void
  deleteSection: (id: string) => void
  moveSection: (dragId: string, targetId: string | null, before: boolean) => void
  setNoteSection: (noteId: string, sectionId: string | null) => void
  toggleFavorite: (noteId: string) => void
  setRenamingNoteId: (id: string | null) => void
  openNoteInCurrentTab: (noteId: string) => void
  openNoteNewTab: (noteId: string) => string
  createTabGroup: (name?: string, color?: string, tabIds?: string[]) => string
  renameTabGroup: (id: string, name: string) => void
  setTabGroupColor: (id: string, color: string) => void
  deleteTabGroup: (id: string) => void
  assignTabToGroup: (tabId: string, groupId: string | null) => void
  toggleTabGroupCollapsed: (id: string) => void
  restoreNote: (id: string) => void
  destroyNote: (id: string) => void
  createNote: (title?: string, sectionId?: string | null) => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'content'>>) => void
  deleteNote: (id: string) => void
  initVault: (force?: boolean) => Promise<void>
  refreshVault: () => Promise<void>
  saveNoteToVault: (id: string) => Promise<void>
  chooseVault: () => Promise<string | null>
  addChatMessage: (role: ChatMessage['role'], text: string) => string
  updateChatMessage: (id: string, text: string) => void
  clearChat: () => void
  calendarItems: CalendarItem[]
  tasks: TaskItem[]
  subscriptions: CalendarSubscription[]
  localCalendarColor: string
  plannerReady: boolean
  plannerError: string | null
  loadPlanner: () => Promise<void>
  addCalendarItem: (draft: CalendarDraft) => void
  updateCalendarItem: (id: string, patch: Partial<CalendarDraft>) => void
  deleteCalendarItem: (id: string) => void
  addTask: (draft: TaskDraft) => string
  updateTask: (id: string, patch: Partial<TaskDraft> & { done?: boolean }) => void
  toggleTask: (id: string) => void
  deleteTask: (id: string) => void
  setLocalCalendarColor: (color: string) => void
  addSubscription: (input: { name: string; url: string; color: string }) => Promise<string>
  updateSubscription: (
    id: string,
    patch: Partial<Pick<CalendarSubscription, 'name' | 'color' | 'enabled'>>
  ) => void
  removeSubscription: (id: string) => void
  refreshSubscription: (id: string) => Promise<void>
  refreshAllSubscriptions: () => Promise<void>
}

function uid(): string {
  return crypto.randomUUID()
}

export interface NoteSection {
  id: string
  title: string
}

/** Google-style tab group colors. */
export const TAB_GROUP_COLORS = [
  '#9aa4b2',
  '#3f8fff',
  '#ff6b6b',
  '#ffbe5a',
  '#2fd066',
  '#ff6b8a',
  '#b284ff',
  '#2fd0e0',
  '#f98b3f'
] as const

export interface TabGroup {
  id: string
  name: string
  color: string
}

/** Drop group assignments for tabs that no longer exist. */
function pruneTabGroupMap(map: Record<string, string>, keep: Set<string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [tabId, groupId] of Object.entries(map)) {
    if (keep.has(tabId)) next[tabId] = groupId
  }
  return next
}

function navTab(kind: NavKey): Tab {
  return { id: uid(), kind }
}

function noteTab(noteId: string): Tab {
  return { id: uid(), kind: 'note', noteId }
}

/** Move a tab id to the front of the recency list (drops duplicates). */
function toFront(recency: string[], id: string): string[] {
  return [id, ...recency.filter((tabId) => tabId !== id)]
}

const MAX_TAB_HISTORY = 100

/**
 * Record a visit: drop any "forward" entries past the cursor, append the tab
 * (unless it repeats the current entry), and cap the length.
 */
function pushHistory(
  history: string[],
  index: number,
  id: string
): { tabHistory: string[]; historyIndex: number } {
  const base = history.slice(0, index + 1)
  if (base[base.length - 1] !== id) base.push(id)
  const tabHistory = base.slice(-MAX_TAB_HISTORY)
  return { tabHistory, historyIndex: tabHistory.length - 1 }
}

/**
 * Drop history entries whose tabs no longer exist, keeping the cursor on the
 * same visit where possible.
 */
function pruneHistory(
  history: string[],
  index: number,
  keep: Set<string>
): { tabHistory: string[]; historyIndex: number } {
  const current = history[index]
  const tabHistory = history.filter((id) => keep.has(id))
  if (tabHistory.length === 0) return { tabHistory, historyIndex: -1 }
  if (current !== undefined && keep.has(current)) {
    return { tabHistory, historyIndex: tabHistory.indexOf(current) }
  }
  return { tabHistory, historyIndex: Math.min(Math.max(index, 0), tabHistory.length - 1) }
}

function blankNote(): Note {
  const now = Date.now()
  return {
    id: uid(),
    title: '',
    content: '',
    fileName: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  }
}

const initialTab = navTab('home')

/** Guard so StrictMode double-mounts and manual refreshes share one load. */
let vaultInitPromise: Promise<void> | null = null

/**
 * Restore the alarm sound selection. Custom entries from before the file
 * protocol existed stored a data URL; those are dropped (and the selection
 * reset) so the UI never claims "custom" while playing a built-in sound.
 */
function restoreAlarmSound(saved: { alarmSoundId?: unknown; customAlarm?: unknown }): {
  alarmSoundId: string
  customAlarm: { name: string; url: string } | null
} {
  const raw = saved.customAlarm
  const customAlarm =
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { name?: unknown }).name === 'string' &&
    typeof (raw as { url?: unknown }).url === 'string'
      ? { name: (raw as { name: string }).name, url: (raw as { url: string }).url }
      : null
  const requested =
    typeof saved.alarmSoundId === 'string' && saved.alarmSoundId.length > 0
      ? saved.alarmSoundId
      : 'classic'
  const alarmSoundId = requested === 'custom' && !customAlarm ? 'classic' : requested
  return { alarmSoundId, customAlarm }
}

type PersistSet = (partial: Partial<AppState>) => void

/** Fire-and-forget vault writes; surface failures in the planner banner. */
function saveCalendarFile(items: CalendarItem[], set: PersistSet): void {
  void window.api.vault.writeJson(CALENDAR_FILE, items).catch((error) => {
    console.error('[planner] failed to save calendar.json', error)
    set({ plannerError: 'Could not save calendar.json.' })
  })
}

function saveTaskFile(tasks: TaskItem[], set: PersistSet): void {
  void window.api.vault.writeJson(TASKS_FILE, tasks).catch((error) => {
    console.error('[planner] failed to save tasks.json', error)
    set({ plannerError: 'Could not save tasks.json.' })
  })
}

function saveCalendarsFile(subscriptions: CalendarSubscription[], set: PersistSet): void {
  void window.api.vault.writeJson(CALENDARS_FILE, subscriptions).catch((error) => {
    console.error('[planner] failed to save calendars.json', error)
    set({ plannerError: 'Could not save calendars.json.' })
  })
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // The mic pipeline is always listening, so the core starts attentive.
      coreState: 'idle',
      notes: [],
      noteOrder: [],
      noteSections: [],
      noteSection: {},
      favorites: [],
      renamingNoteId: null,
      tabs: [initialTab],
      activeTabId: initialTab.id,
      tabRecency: [initialTab.id],
      tabHistory: [initialTab.id],
      historyIndex: 0,
      tabGroups: [],
      tabGroup: {},
      collapsedTabGroups: [],
      query: '',
      vaultPath: null,
      vaultReady: false,
      vaultError: null,
      messages: [],
      calendarItems: [],
      tasks: [],
      subscriptions: [],
      localCalendarColor: CALENDAR_COLORS[0],
      plannerReady: false,
      plannerError: null,
      autoSync: false,
      backgroundListening: false,
      lastSeenAgentId: null,
      ttsEnabled: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      splitTabId: null,
      splitRatio: SPLIT_RATIO_DEFAULT,
      calendarView: 'month',
      calendarCursor: todayISO(),
      alarmTime: null,
      alarmEnabled: false,
      alarmSoundId: 'classic',
      customAlarm: null,
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
      setActiveTab: (id) =>
        set((state) => ({
          activeTabId: id,
          tabRecency: toFront(state.tabRecency, id),
          ...pushHistory(state.tabHistory, state.historyIndex, id)
        })),
      goBackTab: () =>
        set((state) => {
          const index = state.historyIndex - 1
          if (index < 0) return {}
          const id = state.tabHistory[index]
          if (!state.tabs.some((t) => t.id === id)) return {}
          return { activeTabId: id, historyIndex: index, tabRecency: toFront(state.tabRecency, id) }
        }),
      goForwardTab: () =>
        set((state) => {
          const index = state.historyIndex + 1
          if (index >= state.tabHistory.length) return {}
          const id = state.tabHistory[index]
          if (!state.tabs.some((t) => t.id === id)) return {}
          return { activeTabId: id, historyIndex: index, tabRecency: toFront(state.tabRecency, id) }
        }),
      setCalendarView: (calendarView) => set({ calendarView }),
      setCalendarCursor: (calendarCursor) => set({ calendarCursor }),
      openDay: (date) => {
        set({ calendarView: 'day', calendarCursor: date })
        get().openNav('calendar')
      },
      setAlarmTime: (alarmTime) => set({ alarmTime }),
      setAlarmEnabled: (alarmEnabled) => set({ alarmEnabled }),
      setAlarmSoundId: (alarmSoundId) => set({ alarmSoundId }),
      setCustomAlarm: (customAlarm) => set({ customAlarm }),
      openNav: (kind) =>
        set((state) => {
          const existing = state.tabs.find((t) => t.kind === kind)
          if (existing)
            return {
              activeTabId: existing.id,
              tabRecency: toFront(state.tabRecency, existing.id),
              ...pushHistory(state.tabHistory, state.historyIndex, existing.id)
            }
          const tab = navTab(kind)
          return {
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            tabRecency: toFront(state.tabRecency, tab.id),
            ...pushHistory(state.tabHistory, state.historyIndex, tab.id)
          }
        }),
      openNote: (noteId) => {
        // Trashed notes never open; restore them from the Trash section first.
        if (get().notes.find((n) => n.id === noteId)?.deletedAt) return
        set((state) => {
          const existing = state.tabs.find((t) => t.kind === 'note' && t.noteId === noteId)
          if (existing)
            return {
              activeTabId: existing.id,
              tabRecency: toFront(state.tabRecency, existing.id),
              ...pushHistory(state.tabHistory, state.historyIndex, existing.id)
            }
          const tab = noteTab(noteId)
          return {
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            tabRecency: toFront(state.tabRecency, tab.id),
            ...pushHistory(state.tabHistory, state.historyIndex, tab.id)
          }
        })
      },
      openNoteInCurrentTab: (noteId) => {
        if (get().notes.find((n) => n.id === noteId)?.deletedAt) return
        set((state) => {
          const existing = state.tabs.find((t) => t.kind === 'note' && t.noteId === noteId)
          if (existing)
            return {
              activeTabId: existing.id,
              tabRecency: toFront(state.tabRecency, existing.id),
              ...pushHistory(state.tabHistory, state.historyIndex, existing.id)
            }
          // Reuse the active note tab instead of spawning tabs on every click.
          const active = state.tabs.find((t) => t.id === state.activeTabId)
          if (active && active.kind === 'note') {
            return {
              tabs: state.tabs.map((t) =>
                t.id === active.id && t.kind === 'note' ? { ...t, noteId } : t
              ),
              activeTabId: active.id,
              tabRecency: toFront(state.tabRecency, active.id),
              ...pushHistory(state.tabHistory, state.historyIndex, active.id)
            }
          }
          const tab = noteTab(noteId)
          return {
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            tabRecency: toFront(state.tabRecency, tab.id),
            ...pushHistory(state.tabHistory, state.historyIndex, tab.id)
          }
        })
      },
      openNoteNewTab: (noteId) => {
        if (get().notes.find((n) => n.id === noteId)?.deletedAt) return ''
        const tab = noteTab(noteId)
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
          tabRecency: toFront(state.tabRecency, tab.id),
          ...pushHistory(state.tabHistory, state.historyIndex, tab.id)
        }))
        return tab.id
      },
      createTabGroup: (name?: string, color?: string, tabIds?: string[]) => {
        const groups = get().tabGroups
        const group: TabGroup = {
          id: uid(),
          name: (name ?? '').trim() || 'New group',
          color:
            color && TAB_GROUP_COLORS.includes(color as (typeof TAB_GROUP_COLORS)[number])
              ? color
              : TAB_GROUP_COLORS[groups.length % TAB_GROUP_COLORS.length]
        }
        set((state) => {
          const tabGroup = { ...state.tabGroup }
          for (const tabId of tabIds ?? []) {
            if (state.tabs.some((t) => t.id === tabId)) tabGroup[tabId] = group.id
          }
          return { tabGroups: [...state.tabGroups, group], tabGroup }
        })
        return group.id
      },
      renameTabGroup: (id, name) =>
        set((state) => ({
          tabGroups: state.tabGroups.map((g) =>
            g.id === id ? { ...g, name: name.trim() || g.name } : g
          )
        })),
      setTabGroupColor: (id, color) => {
        if (!TAB_GROUP_COLORS.includes(color as (typeof TAB_GROUP_COLORS)[number])) return
        set((state) => ({
          tabGroups: state.tabGroups.map((g) => (g.id === id ? { ...g, color } : g))
        }))
      },
      deleteTabGroup: (id) =>
        set((state) => {
          const tabGroup: Record<string, string> = {}
          for (const [tabId, groupId] of Object.entries(state.tabGroup)) {
            if (groupId !== id) tabGroup[tabId] = groupId
          }
          return {
            tabGroups: state.tabGroups.filter((g) => g.id !== id),
            tabGroup,
            collapsedTabGroups: state.collapsedTabGroups.filter((g) => g !== id)
          }
        }),
      assignTabToGroup: (tabId, groupId) =>
        set((state) => {
          if (!state.tabs.some((t) => t.id === tabId)) return {}
          if (groupId && !state.tabGroups.some((g) => g.id === groupId)) return {}
          const tabGroup = { ...state.tabGroup }
          if (groupId) tabGroup[tabId] = groupId
          else delete tabGroup[tabId]
          return { tabGroup }
        }),
      toggleTabGroupCollapsed: (id) =>
        set((state) => ({
          collapsedTabGroups: state.collapsedTabGroups.includes(id)
            ? state.collapsedTabGroups.filter((g) => g !== id)
            : [...state.collapsedTabGroups, id]
        })),
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
          const keep = new Set(tabs.map((t) => t.id))
          return {
            tabs,
            activeTabId,
            splitTabId,
            tabRecency: state.tabRecency.filter((t) => keep.has(t)),
            ...pruneHistory(state.tabHistory, state.historyIndex, keep),
            tabGroup: pruneTabGroupMap(state.tabGroup, keep)
          }
        }),
      closeAllTabs: () =>
        set({
          tabs: [],
          activeTabId: null,
          splitTabId: null,
          tabRecency: [],
          tabHistory: [],
          historyIndex: -1,
          tabGroup: {}
        }),
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
      createSection: (title?: string) => {
        const section: NoteSection = { id: uid(), title: (title ?? '').trim() || 'New section' }
        set((state) => ({ noteSections: [...state.noteSections, section] }))
        return section.id
      },
      renameSection: (id, title) =>
        set((state) => ({
          noteSections: state.noteSections.map((s) =>
            s.id === id ? { ...s, title: title.trim() || s.title } : s
          )
        })),
      deleteSection: (id) =>
        set((state) => {
          const remaining: Record<string, string> = {}
          for (const [noteId, sectionId] of Object.entries(state.noteSection)) {
            if (sectionId !== id) remaining[noteId] = sectionId
          }
          return {
            noteSections: state.noteSections.filter((s) => s.id !== id),
            noteSection: remaining
          }
        }),
      moveSection: (dragId, targetId, before) =>
        set((state) => {
          if (dragId === targetId) return {}
          const from = state.noteSections.findIndex((s) => s.id === dragId)
          if (from < 0) return {}
          const dragged = state.noteSections[from]
          const without = state.noteSections.filter((s) => s.id !== dragId)
          if (!targetId) return { noteSections: [...without, dragged] }
          let to = without.findIndex((s) => s.id === targetId)
          if (to < 0) return { noteSections: [...without, dragged] }
          if (!before) to += 1
          return { noteSections: [...without.slice(0, to), dragged, ...without.slice(to)] }
        }),
      setNoteSection: (noteId, sectionId) =>
        set((state) => {
          if (sectionId && !state.noteSections.some((s) => s.id === sectionId)) return {}
          const noteSection = { ...state.noteSection }
          if (sectionId) noteSection[noteId] = sectionId
          else delete noteSection[noteId]
          return { noteSection }
        }),
      setRenamingNoteId: (renamingNoteId) => set({ renamingNoteId }),
      toggleFavorite: (noteId) =>
        set((state) => ({
          favorites: state.favorites.includes(noteId)
            ? state.favorites.filter((id) => id !== noteId)
            : [...state.favorites, noteId]
        })),
      createNote: (title?: string, sectionId?: string | null) => {
        const note = { ...blankNote(), title: (title ?? '').trim() }
        const tab = noteTab(note.id)
        set((state) => {
          const taken = new Set(state.notes.map((n) => n.fileName))
          const fileName = uniqueFileName(noteFileBase(note.title), taken)
          // Filing straight into a section pins the note at the top of it:
          // new ids render first, and the section filter keeps the rest out.
          const noteSection = { ...state.noteSection }
          if (sectionId && state.noteSections.some((s) => s.id === sectionId)) {
            noteSection[note.id] = sectionId
          }
          return {
            notes: [{ ...note, fileName }, ...state.notes],
            noteOrder: [note.id, ...state.noteOrder.filter((id) => id !== note.id)],
            noteSection,
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            tabRecency: toFront(state.tabRecency, tab.id),
            ...pushHistory(state.tabHistory, state.historyIndex, tab.id)
          }
        })
        const created = get().notes.find((n) => n.id === note.id)
        if (created && get().vaultReady) {
          void window.api.vault.write(created.fileName, created.content).catch((error) => {
            console.error(`[vault] failed to write ${created.fileName}`, error)
            set({ vaultError: `Could not write ${created.fileName}.` })
          })
        }
        // The sidebar picks this up and opens an inline rename field.
        set({ renamingNoteId: note.id })
        return note.id
      },
      updateNote: (id, patch) =>
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
          )
        })),
      deleteNote: (id) => {
        // Trash, not destroy: the record keeps its order/section slots so
        // restore lands it back in place. initVault auto-purges trash older
        // than 30 days; destroyNote() removes immediately.
        const removed = get().notes.find((n) => n.id === id)
        if (!removed || removed.deletedAt) return
        const removeFile = Boolean(removed.fileName && get().vaultReady)
        set((state) => {
          const notes = state.notes.map((n) => (n.id === id ? { ...n, deletedAt: Date.now() } : n))
          const tabs = state.tabs.filter((t) => !(t.kind === 'note' && t.noteId === id))
          const activeTabId = tabs.some((t) => t.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[0]?.id ?? null)
          const splitTabId =
            state.splitTabId && tabs.some((t) => t.id === state.splitTabId)
              ? state.splitTabId
              : null
          const kept = new Set(tabs.map((t) => t.id))
          return {
            notes,
            tabs,
            activeTabId,
            splitTabId,
            tabRecency: state.tabRecency.filter((t) => kept.has(t)),
            ...pruneHistory(state.tabHistory, state.historyIndex, kept),
            tabGroup: pruneTabGroupMap(state.tabGroup, kept)
          }
        })
        if (removeFile && removed) {
          void window.api.vault.remove(removed.fileName).catch((error) => {
            console.error(`[vault] failed to remove ${removed.fileName}`, error)
          })
        }
      },
      restoreNote: (id) => {
        const note = get().notes.find((n) => n.id === id)
        if (!note?.deletedAt) return
        const taken = new Set(
          get()
            .notes.filter((n) => n.id !== id)
            .map((n) => n.fileName)
        )
        const fileName = uniqueFileName(note.fileName || noteFileBase(note.title), taken)
        set((state) => ({
          notes: state.notes.map((n) => (n.id === id ? { ...n, deletedAt: null, fileName } : n))
        }))
        if (get().vaultReady) {
          void window.api.vault.write(fileName, note.content).catch((error) => {
            console.error(`[vault] failed to restore ${fileName}`, error)
            set({ vaultError: `Could not restore ${fileName}.` })
          })
        }
      },
      destroyNote: (id) => {
        // Permanent: drops the record, order/section/favorite slots, and tabs.
        const removed = get().notes.find((n) => n.id === id)
        if (!removed) return
        const removeFile = Boolean(removed.fileName && get().vaultReady)
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
          const kept = new Set(tabs.map((t) => t.id))
          const noteSection = { ...state.noteSection }
          delete noteSection[id]
          return {
            notes,
            noteOrder,
            tabs,
            activeTabId,
            splitTabId,
            tabRecency: state.tabRecency.filter((t) => kept.has(t)),
            ...pruneHistory(state.tabHistory, state.historyIndex, kept),
            noteSection,
            favorites: state.favorites.filter((fav) => fav !== id),
            tabGroup: pruneTabGroupMap(state.tabGroup, kept)
          }
        })
        if (removeFile && removed) {
          void window.api.vault.remove(removed.fileName).catch(() => {})
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
                    updatedAt: Math.round(entry.mtimeMs) || Date.now(),
                    deletedAt: null
                  })
                }
                taken.add(entry.fileName)
              }
              // Notes missing on disk (new, or pre-vault) get written out.
              // Trashed notes stay fileless — their files were removed on trash.
              for (const note of state.notes) {
                if (note.deletedAt) continue
                if (disk.some((entry) => entry.fileName === note.fileName)) continue
                const fileName = uniqueFileName(note.fileName || noteFileBase(note.title), taken)
                taken.add(fileName)
                notes.push(fileName === note.fileName ? note : { ...note, fileName })
                pendingWrites.push({ id: note.id, fileName })
              }
              // Trash older than 30 days is destroyed, not restored.
              const retained = notes.filter(
                (n) => !n.deletedAt || Date.now() - n.deletedAt < TRASH_RETENTION_MS
              )
              if (retained.length !== notes.length) {
                console.info(
                  `[vault] purged ${notes.length - retained.length} trashed notes (30d+)`
                )
              }
              const noteIds = new Set(retained.map((n) => n.id))
              const tabs = state.tabs.filter(
                (tab) => tab.kind !== 'note' || noteIds.has(tab.noteId)
              )
              const withTabs = tabs.length > 0 ? tabs : [navTab('home')]
              const activeTabId = withTabs.some((t) => t.id === state.activeTabId)
                ? state.activeTabId
                : withTabs[0].id
              const withTabIds = new Set(withTabs.map((t) => t.id))
              const keptHistory = pruneHistory(state.tabHistory, state.historyIndex, withTabIds)
              // Fresh vaults (or pre-history saves) start history at the
              // restored tab so Back has somewhere to go.
              if (keptHistory.tabHistory.length === 0 && withTabs.length > 0 && activeTabId) {
                keptHistory.tabHistory.push(activeTabId)
                keptHistory.historyIndex = 0
              }
              // Keep the manual order, drop stale ids, surface unpositioned
              // notes (imports, pre-vault notes) up top by recency.
              const keptOrder = state.noteOrder.filter((id) => noteIds.has(id))
              const keptSet = new Set(keptOrder)
              const unpositioned = retained
                .filter((n) => !keptSet.has(n.id))
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((n) => n.id)
              return {
                notes: retained,
                noteOrder: [...unpositioned, ...keptOrder],
                tabs: withTabs,
                activeTabId,
                tabRecency: [
                  ...state.tabRecency.filter((id) => withTabIds.has(id)),
                  ...withTabs.map((t) => t.id).filter((id) => !state.tabRecency.includes(id))
                ],
                tabGroup: pruneTabGroupMap(state.tabGroup, withTabIds),
                tabHistory: keptHistory.tabHistory,
                historyIndex: keptHistory.historyIndex
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
            // Vault is up — pull planner JSON next (missing files load empty).
            void get().loadPlanner()
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
        if (!note || note.deletedAt) return
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
      clearChat: () => set({ messages: [] }),
      loadPlanner: async () => {
        try {
          const [calendarRaw, tasksRaw, legacyRaw, calendarsRaw] = await Promise.all([
            window.api.vault.readJson(CALENDAR_FILE),
            window.api.vault.readJson(TASKS_FILE),
            window.api.vault.readJson(TODO_FILE),
            window.api.vault.readJson(CALENDARS_FILE)
          ])
          const { events, migratedTasks } = parseCalendarData(calendarRaw)
          const byId = new Map(parseTaskItems(tasksRaw).map((task) => [task.id, task]))
          let migrated = 0
          for (const task of migratedTasks) {
            if (!byId.has(task.id)) {
              byId.set(task.id, task)
              migrated += 1
            }
          }
          // One-time move from the pre-rename `todo.json` store.
          let legacyMigrated = 0
          for (const task of parseTaskItems(legacyRaw)) {
            if (!byId.has(task.id)) {
              byId.set(task.id, task)
              legacyMigrated += 1
            }
          }
          const tasks = [...byId.values()]
          const subscriptions = parseSubscriptions(calendarsRaw)
          set({
            calendarItems: events,
            tasks,
            subscriptions,
            plannerReady: true,
            plannerError: null
          })
          // Tasks used to live in calendar.json; persist the split once.
          if (migrated > 0) {
            await window.api.vault.writeJson(CALENDAR_FILE, events)
            console.info(`[planner] migrated ${migrated} calendar tasks into tasks.json`)
          }
          if (migrated > 0 || legacyMigrated > 0) {
            await window.api.vault.writeJson(TASKS_FILE, tasks)
          }
          if (legacyMigrated > 0) {
            // Retire the legacy file so its items can never resurrect.
            await window.api.vault.writeJson(TODO_FILE, [])
            console.info(`[planner] migrated ${legacyMigrated} tasks from todo.json`)
          }
          void get().refreshAllSubscriptions()
        } catch (error) {
          console.error('[planner] failed to load planner data', error)
          set({ plannerError: 'Could not load calendar/task data.', plannerReady: true })
        }
      },
      addCalendarItem: (draft) => {
        const item = calendarItemFromDraft(uid(), draft, Date.now())
        const items = [...get().calendarItems, item]
        set({ calendarItems: items, plannerError: null })
        saveCalendarFile(items, set)
      },
      updateCalendarItem: (id, patch) => {
        const current = get().calendarItems.find((item) => item.id === id)
        if (!current) return
        const draft = { ...draftFromItem(current), ...patch }
        const items = get().calendarItems.map((item) =>
          item.id === id
            ? calendarItemFromDraft(id, draft, Date.now(), {
                createdAt: item.createdAt,
                status: item.status,
                exdates: item.exdates,
                calendarId: item.calendarId
              })
            : item
        )
        set({ calendarItems: items, plannerError: null })
        saveCalendarFile(items, set)
      },
      deleteCalendarItem: (id) => {
        const items = get().calendarItems.filter((item) => item.id !== id)
        set({ calendarItems: items, plannerError: null })
        saveCalendarFile(items, set)
      },
      addTask: (draft) => {
        const item = taskItemFromDraft(uid(), draft, false, Date.now())
        const tasks = [item, ...get().tasks]
        set({ tasks, plannerError: null })
        saveTaskFile(tasks, set)
        return item.id
      },
      updateTask: (id, patch) => {
        const current = get().tasks.find((item) => item.id === id)
        if (!current) return
        const draft: TaskDraft = {
          title: patch.title ?? current.title,
          notes: patch.notes ?? current.notes,
          location: patch.location ?? current.location,
          due: patch.due !== undefined ? patch.due : current.due,
          time: patch.time !== undefined ? patch.time : current.time
        }
        const done = patch.done ?? current.status === 'completed'
        const tasks = get().tasks.map((item) =>
          item.id === id
            ? taskItemFromDraft(id, draft, done, Date.now(), { createdAt: item.createdAt })
            : item
        )
        set({ tasks, plannerError: null })
        saveTaskFile(tasks, set)
      },
      toggleTask: (id) => {
        const current = get().tasks.find((item) => item.id === id)
        if (current) get().updateTask(id, { done: current.status !== 'completed' })
      },
      deleteTask: (id) => {
        const tasks = get().tasks.filter((item) => item.id !== id)
        set({ tasks, plannerError: null })
        saveTaskFile(tasks, set)
      },
      setLocalCalendarColor: (localCalendarColor) => set({ localCalendarColor }),
      addSubscription: async ({ name, url, color }) => {
        const id = uid()
        const subscription: CalendarSubscription = {
          id,
          name: name.trim() || 'Subscribed calendar',
          url: url.trim(),
          color,
          enabled: true,
          lastFetched: null,
          error: null,
          events: []
        }
        const subscriptions = [...get().subscriptions, subscription]
        set({ subscriptions })
        saveCalendarsFile(subscriptions, set)
        await get().refreshSubscription(id)
        return id
      },
      updateSubscription: (id, patch) => {
        const subscriptions = get().subscriptions.map((sub) =>
          sub.id === id ? { ...sub, ...patch } : sub
        )
        set({ subscriptions })
        saveCalendarsFile(subscriptions, set)
      },
      removeSubscription: (id) => {
        const subscriptions = get().subscriptions.filter((sub) => sub.id !== id)
        set({ subscriptions })
        saveCalendarsFile(subscriptions, set)
      },
      refreshSubscription: async (id) => {
        const sub = get().subscriptions.find((s) => s.id === id)
        if (!sub) return
        try {
          const text = await window.api.fetchIcs(sub.url)
          const now = Date.now()
          const events: CalendarItem[] = []
          for (const event of parseIcs(text)) {
            events.push({
              id: `${id}:${event.uid}`,
              summary: event.summary || 'Untitled',
              description: event.description,
              location: event.location,
              start: event.start,
              end: event.end,
              status: 'confirmed',
              recurrence: event.recurrence,
              exdates: event.exdates,
              calendarId: id,
              createdAt: now,
              updatedAt: now
            })
          }
          const subscriptions = get().subscriptions.map((s) =>
            s.id === id ? { ...s, events, lastFetched: now, error: null } : s
          )
          set({ subscriptions })
          saveCalendarsFile(subscriptions, set)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not load the feed.'
          console.error(`[planner] subscription ${id} failed`, error)
          const subscriptions = get().subscriptions.map((s) =>
            s.id === id ? { ...s, error: message } : s
          )
          set({ subscriptions })
          saveCalendarsFile(subscriptions, set)
        }
      },
      refreshAllSubscriptions: async () => {
        const ids = get()
          .subscriptions.filter((sub) => sub.enabled)
          .map((sub) => sub.id)
        for (const id of ids) {
          await get().refreshSubscription(id)
        }
      }
    }),
    {
      name: 'seemo-store',
      // Only documents, open tabs, sidebar order and chat history persist.
      partialize: (state) => ({
        notes: state.notes,
        noteOrder: state.noteOrder,
        noteSections: state.noteSections,
        noteSection: state.noteSection,
        favorites: state.favorites,
        tabGroups: state.tabGroups,
        tabGroup: state.tabGroup,
        collapsedTabGroups: state.collapsedTabGroups,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        tabRecency: state.tabRecency,
        tabHistory: state.tabHistory,
        historyIndex: state.historyIndex,
        messages: state.messages.slice(-MAX_CHAT_MESSAGES),
        autoSync: state.autoSync,
        backgroundListening: state.backgroundListening,
        lastSeenAgentId: state.lastSeenAgentId,
        ttsEnabled: state.ttsEnabled,
        sidebarWidth: state.sidebarWidth,
        splitTabId: state.splitTabId,
        splitRatio: state.splitRatio,
        localCalendarColor: state.localCalendarColor,
        alarmTime: state.alarmTime,
        alarmEnabled: state.alarmEnabled,
        alarmSoundId: state.alarmSoundId,
        customAlarm: state.customAlarm
      }),
      // Drop note tabs whose note no longer exists (e.g. after an older
      // session) and always leave at least one tab open.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<
          Pick<
            AppState,
            | 'notes'
            | 'noteOrder'
            | 'noteSections'
            | 'noteSection'
            | 'favorites'
            | 'tabGroups'
            | 'tabGroup'
            | 'collapsedTabGroups'
            | 'tabs'
            | 'activeTabId'
            | 'tabRecency'
            | 'tabHistory'
            | 'historyIndex'
            | 'messages'
            | 'autoSync'
            | 'backgroundListening'
            | 'lastSeenAgentId'
            | 'ttsEnabled'
            | 'sidebarWidth'
            | 'splitTabId'
            | 'splitRatio'
            | 'localCalendarColor'
            | 'alarmTime'
            | 'alarmEnabled'
            | 'alarmSoundId'
            | 'customAlarm'
          >
        >
        const notes = saved.notes ?? []
        const noteIds = new Set(notes.map((n) => n.id))
        const restored = (saved.tabs ?? [])
          .map((tab): Tab => {
            // Pre-rename sessions saved the task list as kind 'todo'.
            if ((tab as { kind?: string }).kind === 'todo') return { id: tab.id, kind: 'tasks' }
            return tab
          })
          .filter((tab) => tab.kind !== 'note' || noteIds.has(tab.noteId))
        const tabs = restored.length > 0 ? restored : [navTab('home')]
        const activeTabId = tabs.some((t) => t.id === saved.activeTabId)
          ? (saved.activeTabId as string)
          : tabs[0].id
        // Recency survives restarts: keep known ids most-recent-first, then
        // append any restored tab the old list never saw.
        const tabIds = new Set(tabs.map((t) => t.id))
        const tabRecency = [
          ...(saved.tabRecency ?? []).filter((id) => tabIds.has(id)),
          ...tabs.map((t) => t.id).filter((id) => !(saved.tabRecency ?? []).includes(id))
        ]
        // History survives restarts too; seed from the active tab when the
        // saved list is empty or predates this feature.
        const pruned = pruneHistory(saved.tabHistory ?? [], saved.historyIndex ?? -1, tabIds)
        const tabHistory = pruned.tabHistory.length > 0 ? pruned.tabHistory : [activeTabId]
        const historyIndex = pruned.tabHistory.length > 0 ? pruned.historyIndex : 0
        const messages = (saved.messages ?? []).slice(-MAX_CHAT_MESSAGES)
        const noteOrder = (saved.noteOrder ?? []).filter((id) => noteIds.has(id))
        // Sections survive restarts; drop mappings for notes or sections
        // that no longer exist so orphans render ungrouped.
        const noteSections = (saved.noteSections ?? []).filter(
          (s) => s && typeof s.id === 'string' && typeof s.title === 'string'
        )
        const sectionIds = new Set(noteSections.map((s) => s.id))
        const noteSection: Record<string, string> = {}
        for (const [noteId, sectionId] of Object.entries(saved.noteSection ?? {})) {
          if (noteIds.has(noteId) && sectionIds.has(sectionId)) noteSection[noteId] = sectionId
        }
        const favorites = (saved.favorites ?? []).filter((id) => noteIds.has(id))
        const tabGroups = (saved.tabGroups ?? []).filter(
          (g) =>
            g &&
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            typeof g.color === 'string'
        )
        const groupIds = new Set(tabGroups.map((g) => g.id))
        const tabGroup: Record<string, string> = {}
        for (const [tabId, groupId] of Object.entries(saved.tabGroup ?? {})) {
          if (tabIds.has(tabId) && groupIds.has(groupId)) tabGroup[tabId] = groupId
        }
        const collapsedTabGroups = (saved.collapsedTabGroups ?? []).filter((id) => groupIds.has(id))
        // Never pop the bubble for history that predates this launch: seed
        // "seen" at the newest restored SeeMO message.
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
          noteSections,
          noteSection,
          favorites,
          tabGroups,
          tabGroup,
          collapsedTabGroups,
          tabs,
          activeTabId,
          tabRecency,
          tabHistory,
          historyIndex,
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
          localCalendarColor:
            typeof saved.localCalendarColor === 'string' && saved.localCalendarColor
              ? saved.localCalendarColor
              : CALENDAR_COLORS[0],
          alarmTime: typeof saved.alarmTime === 'string' ? saved.alarmTime : null,
          alarmEnabled: saved.alarmEnabled ?? false,
          ...restoreAlarmSound(saved),
          lastSeenAgentId
        }
      }
    }
  )
)
