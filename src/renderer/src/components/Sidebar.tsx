import { useEffect, useMemo, useRef, useState } from 'react'
import { NAV_ITEMS } from '../nav'
import { buildNoteGraph, orderedNotes } from '../notes'
import { importDroppedPicture } from '../images'
import { LOCAL_CALENDAR_ID, expandItemDates, todayISO, type CalendarItem } from '../planner'
import {
  SIDEBAR_DEFAULT_WIDTH,
  TRASH_RETENTION_MS,
  clampSidebarWidth,
  useAppStore,
  type Note
} from '../store/appStore'
import {
  CalendarIcon,
  ChevronDownIcon,
  FileTextIcon,
  GraphIcon,
  MoreIcon,
  PlusIcon,
  RestoreIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  TrashIcon
} from './icons'

/** Sidebar search hint shows the macOS ⌘ glyph where it applies. */
const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** "9:00 AM" from an event start (all-day events have no time part). */
function formatEventTime(item: CalendarItem): string {
  const time = item.start.dateTime?.split('T')[1]?.slice(0, 5)
  if (!time) return 'All day'
  return formatClock(time)
}

/** "14:30" -> "2:30 PM". */
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * Today at a glance: today's calendar events (local + enabled subscriptions,
 * recurrence-aware) above today's tasks (due today or overdue). Replaces the
 * old "upcoming events" placeholder, which never showed anything actionable.
 */
function TodaySection(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const calendarItems = useAppStore((state) => state.calendarItems)
  const subscriptions = useAppStore((state) => state.subscriptions)
  const localCalendarColor = useAppStore((state) => state.localCalendarColor)
  const plannerReady = useAppStore((state) => state.plannerReady)
  const tasks = useAppStore((state) => state.tasks)
  const toggleTask = useAppStore((state) => state.toggleTask)
  const openNav = useAppStore((state) => state.openNav)

  const today = todayISO()

  const events = useMemo(() => {
    const colors = new Map<string, string>([[LOCAL_CALENDAR_ID, localCalendarColor]])
    const items: CalendarItem[] = [...calendarItems]
    for (const sub of subscriptions) {
      if (!sub.enabled) continue
      colors.set(sub.id, sub.color)
      items.push(...sub.events)
    }
    const rows: { id: string; title: string; time: string; sort: string; color: string }[] = []
    for (const item of items) {
      if (expandItemDates(item, today, today).length === 0) continue
      rows.push({
        id: item.id,
        title: item.summary.trim() || 'Untitled',
        time: formatEventTime(item),
        sort: item.start.dateTime ?? `${today}T99:99`,
        color: colors.get(item.calendarId) ?? localCalendarColor
      })
    }
    rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    return rows
  }, [calendarItems, subscriptions, localCalendarColor, today])

  const todaysTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== 'completed' && task.due !== null && task.due <= today)
        .sort((a, b) => ((a.due ?? '') + (a.time ?? '') < (b.due ?? '') + (b.time ?? '') ? -1 : 1)),
    [tasks, today]
  )

  const count = events.length + todaysTasks.length

  return (
    <section className="sidebar__events" aria-label="Today">
      <div className="sidebar__section-head sidebar__today-head">
        <button
          type="button"
          className="sidebar__section-head--toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sidebar__section-title">Today</span>
          {count > 0 && <span className="sidebar__today-count">{count}</span>}
          <ChevronDownIcon size={14} className={`sidebar__chevron${open ? ' is-open' : ''}`} />
        </button>
        <button
          type="button"
          className="sidebar__icon-btn"
          title="Open calendar"
          aria-label="Open calendar"
          onClick={() => openNav('calendar')}
        >
          <CalendarIcon size={14} />
        </button>
      </div>
      {open && (
        <>
          {events.length > 0 && <p className="sidebar__today-group">Events</p>}
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              className="sidebar__today-row"
              title={`${event.title} · ${event.time}`}
              onClick={() => openNav('calendar')}
            >
              <span className="sidebar__today-dot" style={{ background: event.color }} />
              <span className="sidebar__today-time">{event.time}</span>
              <span className="sidebar__label">{event.title}</span>
            </button>
          ))}
          {todaysTasks.length > 0 && <p className="sidebar__today-group">Tasks</p>}
          {todaysTasks.map((task) => (
            <div key={task.id} className="sidebar__today-row" title={task.title}>
              <input
                type="checkbox"
                className="sidebar__today-check"
                checked={false}
                aria-label={`Mark done: ${task.title || 'Untitled'}`}
                onChange={() => toggleTask(task.id)}
              />
              <span className="sidebar__label">
                {task.title.trim() || 'Untitled'}{' '}
                {task.due !== null && task.due < today && (
                  <span className="sidebar__today-overdue">overdue</span>
                )}
              </span>
              {task.time && <span className="sidebar__today-time">{formatClock(task.time)}</span>}
            </div>
          ))}
          {count === 0 && (
            <p className="sidebar__empty">{plannerReady ? 'Nothing on for today.' : 'Loading…'}</p>
          )}
        </>
      )}
    </section>
  )
}

function Sidebar(): React.JSX.Element {
  const activeTab = useAppStore(
    (state) => state.tabs.find((t) => t.id === state.activeTabId) ?? null
  )
  const notes = useAppStore((state) => state.notes)
  const noteOrder = useAppStore((state) => state.noteOrder)
  const query = useAppStore((state) => state.query)
  const coreState = useAppStore((state) => state.coreState)
  const openNav = useAppStore((state) => state.openNav)
  const openNoteInCurrentTab = useAppStore((state) => state.openNoteInCurrentTab)
  const openNoteNewTab = useAppStore((state) => state.openNoteNewTab)
  const updateNote = useAppStore((state) => state.updateNote)
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)
  const restoreNote = useAppStore((state) => state.restoreNote)
  const destroyNote = useAppStore((state) => state.destroyNote)
  const emptyTrash = useAppStore((state) => state.emptyTrash)
  const favorites = useAppStore((state) => state.favorites)
  const setQuery = useAppStore((state) => state.setQuery)
  const createNote = useAppStore((state) => state.createNote)
  const deleteNote = useAppStore((state) => state.deleteNote)
  const moveNote = useAppStore((state) => state.moveNote)
  const noteSections = useAppStore((state) => state.noteSections)
  const noteSection = useAppStore((state) => state.noteSection)
  const createSection = useAppStore((state) => state.createSection)
  const renameSection = useAppStore((state) => state.renameSection)
  const deleteSection = useAppStore((state) => state.deleteSection)
  const moveSection = useAppStore((state) => state.moveSection)
  const setNoteSection = useAppStore((state) => state.setNoteSection)
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; before: boolean } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [sectionDraggingId, setSectionDraggingId] = useState<string | null>(null)
  const [sectionDropHint, setSectionDropHint] = useState<{ id: string; before: boolean } | null>(
    null
  )
  const [noteOverSection, setNoteOverSection] = useState<string | null>(null)
  const [dropNoteId, setDropNoteId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ noteId: string; x: number; y: number } | null>(null)
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number } | null>(null)

  const clampMenu = (x: number, y: number): { x: number; y: number } => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 190)),
    y: Math.max(8, Math.min(y, window.innerHeight - 300))
  })

  const openMenuAt = (noteId: string, x: number, y: number): void => {
    const at = clampMenu(x, y)
    setMenu({ noteId, ...at })
  }
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameNoteDraft, setRenameNoteDraft] = useState('')
  const [trashOpen, setTrashOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const dragIdRef = useRef<string | null>(null)
  const sectionDragRef = useRef<string | null>(null)
  const asideRef = useRef<HTMLElement>(null)
  const resizeStartRef = useRef({ x: 0, width: 0 })

  const activeNoteId = activeTab?.kind === 'note' ? activeTab.noteId : null
  const needle = query.trim().toLowerCase()

  const matchesQuery = (note: Note): boolean =>
    !needle ||
    note.title.toLowerCase().includes(needle) ||
    note.content.toLowerCase().includes(needle)

  // Outgoing `[[links]]` per note (deduped, self-links dropped).
  // Top level shows roots only: a note with a parent lives nested under it,
  // never beside it. While searching, fall back to a flat match list so
  // results are never hidden inside collapsed parents.
  const liveNotes = useMemo(() => notes.filter((note) => !note.deletedAt), [notes])
  const graph = useMemo(
    () => buildNoteGraph(orderedNotes(liveNotes, noteOrder)),
    [liveNotes, noteOrder]
  )
  const visibleNotes = (needle ? orderedNotes(liveNotes, noteOrder) : graph.roots).filter(
    matchesQuery
  )
  const favoriteRoots = visibleNotes.filter((note) => favorites.includes(note.id))
  const trashed = useMemo(
    () =>
      notes
        .filter((note) => note.deletedAt)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notes]
  )

  const toggleExpand = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const clearDrag = (): void => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropHint(null)
    setNoteOverSection(null)
  }

  const clearSectionDrag = (): void => {
    sectionDragRef.current = null
    setSectionDraggingId(null)
    setSectionDropHint(null)
  }

  // Valid section for a note, or null for ungrouped (unknown ids fall out).
  const sectionIds = new Set(noteSections.map((s) => s.id))
  const sectionOf = (noteId: string): string | null => {
    const id = noteSection[noteId]
    return id !== undefined && sectionIds.has(id) ? id : null
  }

  const positionAbove = (event: React.DragEvent<HTMLElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top < rect.height / 2
  }

  const positionFromEvent = (event: React.DragEvent<HTMLLIElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top < rect.height / 2
  }

  const onNoteDrop = (event: React.DragEvent<HTMLLIElement>, noteId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const dragId = dragIdRef.current
    clearDrag()
    if (dragId && dragId !== noteId) {
      // Adopt the target's section when dragging across dividers.
      if (sectionOf(dragId) !== sectionOf(noteId)) setNoteSection(dragId, sectionOf(noteId))
      moveNote(dragId, noteId, positionFromEvent(event))
    }
  }

  const isPictureDragTypes = (types: Iterable<string> | ArrayLike<string>): boolean =>
    Array.from(types as ArrayLike<string>).some(
      (type) => type === 'Files' || type === 'text/uri-list'
    )

  // Dropping pictures straight onto a row appends them to that note
  // (handy when it isn't open). Files validate in main; URLs need http(s).
  const onRowDropPictures = async (event: React.DragEvent, noteId: string): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDropNoteId(null)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const blocks: string[] = []
    for (const file of Array.from(event.dataTransfer.files ?? [])) {
      try {
        blocks.push(await importDroppedPicture(file))
      } catch (error) {
        console.error('[sidebar] picture drop failed', error)
      }
    }
    const urls = event.dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line))
    for (const url of urls) {
      let alt = 'image'
      try {
        alt = new URL(url).hostname || alt
      } catch {
        // keep the fallback label
      }
      blocks.push(`![${alt}](${url})`)
    }
    if (blocks.length === 0) return
    const target = useAppStore.getState().notes.find((n) => n.id === noteId)
    if (!target || target.deletedAt) return
    const body = target.content.trimEnd()
    useAppStore
      .getState()
      .updateNote(noteId, { content: `${body}${body ? '\n\n' : ''}${blocks.join('\n\n')}\n` })
  }

  const onListDrop = (event: React.DragEvent<HTMLUListElement>): void => {
    // Only fires for empty list space; note drops stop propagation above.
    event.preventDefault()
    const dragId = dragIdRef.current
    clearDrag()
    if (dragId) {
      setNoteSection(dragId, null)
      moveNote(dragId, null, false)
    }
  }

  // Drop a note onto a section: file it there, pinned after that section's
  // last root so it lands inside the group.
  const assignToSection = (dragId: string, sectionId: string | null): void => {
    const peers = visibleNotes.filter((n) => n.id !== dragId && sectionOf(n.id) === sectionId)
    setNoteSection(dragId, sectionId)
    if (peers.length > 0) moveNote(dragId, peers[peers.length - 1].id, false)
    else moveNote(dragId, null, false)
  }

  const onSectionDrop = (event: React.DragEvent<HTMLDivElement>, sectionId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const secDrag = sectionDragRef.current
    const noteDrag = dragIdRef.current
    clearDrag()
    clearSectionDrag()
    // Divider-on-divider reorders sections; note-on-divider files the note.
    if (secDrag && secDrag !== sectionId) {
      moveSection(secDrag, sectionId, positionAbove(event))
    } else if (noteDrag) {
      assignToSection(noteDrag, sectionId)
    }
  }

  const onSectionListDrop = (event: React.DragEvent<HTMLUListElement>, sectionId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const noteDrag = dragIdRef.current
    clearDrag()
    if (noteDrag) assignToSection(noteDrag, sectionId)
  }

  const newSection = (): void => {
    const id = createSection()
    const created = useAppStore.getState().noteSections.find((s) => s.id === id)
    setRenameDraft(created?.title ?? 'New section')
    setRenamingId(id)
  }

  const commitRename = (): void => {
    if (renamingId) renameSection(renamingId, renameDraft)
    setRenamingId(null)
  }

  const toggleCollapsed = (id: string): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmDeleteSection = (id: string, title: string): void => {
    if (window.confirm(`Delete section "${title}"? Its notes stay under Notes.`)) {
      deleteSection(id)
    }
  }

  const startRenameNote = (note: Note): void => {
    setMenu(null)
    setRenamingNoteId(note.id)
    setRenameNoteDraft(note.title)
  }

  const commitRenameNote = (): void => {
    const id = renamingNoteId
    setRenamingNoteId(null)
    if (!id) return
    const live = useAppStore.getState().notes.find((n) => n.id === id)
    const title = renameNoteDraft.trim()
    if (live && !live.deletedAt && title !== live.title) updateNote(id, { title })
  }

  const trashNote = (note: Note): void => {
    const label = note.title.trim() || 'Untitled'
    if (window.confirm(`Delete "${label}"? You can restore it from Trash within 30 days.`)) {
      deleteNote(note.id)
    }
  }

  const destroyNoteForever = (note: Note): void => {
    const label = note.title.trim() || 'Untitled'
    if (window.confirm(`Destroy "${label}" forever? This cannot be undone.`)) {
      destroyNote(note.id)
    }
  }

  // Esc closes the row/space menus.
  useEffect(() => {
    if (!menu && !spaceMenu) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenu(null)
        setSpaceMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, spaceMenu])

  const expandAll = (): void => {
    setExpandedIds(new Set(visibleNotes.map((n) => n.id)))
    setCollapsedIds(new Set())
  }

  const collapseAll = (): void => {
    setExpandedIds(new Set())
    setCollapsedIds(new Set(noteSections.map((s) => s.id)))
  }

  // Split view for a note: reuse a background tab for it, or open a fresh
  // one beside the current tab when it is already showing the note.
  const splitNote = (noteId: string): void => {
    const state = useAppStore.getState()
    const prevActive = state.activeTabId
    const background = state.tabs.find(
      (t) => t.kind === 'note' && t.noteId === noteId && t.id !== prevActive
    )
    if (background) {
      state.setSplitTab(background.id)
      return
    }
    const id = state.openNoteNewTab(noteId)
    if (!id) return
    if (prevActive) state.setActiveTab(prevActive)
    if (useAppStore.getState().activeTabId !== id) state.setSplitTab(id)
  }

  // "Today" math is render-stable for the life of this mount; trash ages in
  // whole days, so a per-mount timestamp never visibly drifts.
  const [nowMs] = useState(() => Date.now())

  // New pages arrive with a rename signal: open the inline field on the row.
  // Deferred a frame so the rename state lands as an event-style update.
  const renamingSignal = useAppStore((state) => state.renamingNoteId)
  useEffect(() => {
    if (!renamingSignal) return
    const frame = requestAnimationFrame(() => {
      const { notes: live, setRenamingNoteId: clear } = useAppStore.getState()
      clear(null)
      const note = live.find((n) => n.id === renamingSignal)
      if (!note || note.deletedAt) return
      setRenamingNoteId(note.id)
      setRenameNoteDraft(note.title)
      document.querySelector(`[data-note-row="${note.id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [renamingSignal])

  const trashDaysLeft = (deletedAt: number, now: number): string => {
    const days = Math.max(
      0,
      Math.ceil((deletedAt + TRASH_RETENTION_MS - now) / (24 * 60 * 60 * 1000))
    )
    return days <= 0 ? 'today' : `${days}d`
  }

  // Sidebar edge drag: paint live via the DOM for 60fps, commit to the
  // store (and persistence) once on release.
  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStartRef.current = {
      x: event.clientX,
      width: asideRef.current?.offsetWidth ?? sidebarWidth
    }
    setResizing(true)
  }

  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const next = clampSidebarWidth(
      resizeStartRef.current.width + (event.clientX - resizeStartRef.current.x)
    )
    if (asideRef.current) asideRef.current.style.width = `${next}px`
  }

  const onResizeEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    setResizing(false)
    setSidebarWidth(
      clampSidebarWidth(resizeStartRef.current.width + (event.clientX - resizeStartRef.current.x))
    )
    // Hand width back to the store value so later renders stay in sync.
    if (asideRef.current) asideRef.current.style.width = ''
  }

  // Notion-style tree: a note with outgoing [[links]] expands to reveal those
  // child pages nested beneath it. Only top-level rows are draggable; nested
  // rows are link views into the same flat order. `ancestors` guards cycles.
  const renderTree = (note: Note, depth: number, ancestors: string[]): React.JSX.Element => {
    const kids = (graph.children.get(note.id) ?? []).filter(
      (kid) => !ancestors.includes(kid.id) && matchesQuery(kid)
    )
    const isOpen = expandedIds.has(note.id)
    const hint = depth === 0 && dropHint?.id === note.id ? dropHint : null
    const dragAttrs =
      depth === 0
        ? {
            draggable: true as const,
            onDragStart: (event: React.DragEvent<HTMLLIElement>): void => {
              dragIdRef.current = note.id
              setDraggingId(note.id)
              event.dataTransfer.effectAllowed = 'move'
            },
            onDragEnd: () => {
              clearDrag()
              setDropNoteId(null)
            },
            onDragOver: (event: React.DragEvent<HTMLLIElement>): void => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dragIdRef.current && dragIdRef.current !== note.id) {
                setDropHint({ id: note.id, before: positionFromEvent(event) })
              }
              if (isPictureDragTypes(event.dataTransfer.types ?? [])) {
                setDropNoteId(note.id)
              }
            },
            onDragLeave: () => setDropNoteId(null),
            onDrop: (event: React.DragEvent<HTMLLIElement>): void => {
              // Internal reorders (note/section drags) keep working when the
              // platform reports no types; anything carrying files or URLs
              // from outside the app is a picture drop.
              const internal = dragIdRef.current !== null || sectionDragRef.current !== null
              const external =
                event.dataTransfer.files.length > 0 ||
                event.dataTransfer.getData('text/uri-list').trim().length > 0
              if (external && !internal) void onRowDropPictures(event, note.id)
              else onNoteDrop(event, note.id)
              setDropNoteId(null)
            }
          }
        : {}
    return (
      <li
        key={note.id}
        {...dragAttrs}
        className={`sidebar__note${draggingId === note.id && depth === 0 ? ' sidebar__note--dragging' : ''}${hint ? (hint.before ? ' sidebar__note--drop-before' : ' sidebar__note--drop-after') : ''}${dropNoteId === note.id ? ' is-drop-target' : ''}`}
      >
        <div
          data-note-row={note.id}
          className={`sidebar__row sidebar__row--note${
            activeNoteId === note.id ? ' is-active' : ''
          }`}
          onContextMenu={(event) => {
            if (renamingNoteId === note.id) return
            event.preventDefault()
            openMenuAt(note.id, event.clientX, event.clientY)
          }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              className={`sidebar__twisty${isOpen ? ' is-open' : ''}`}
              aria-expanded={isOpen}
              aria-label={
                isOpen
                  ? `Collapse ${note.title || 'Untitled'}`
                  : `Expand ${note.title || 'Untitled'}`
              }
              onClick={() => toggleExpand(note.id)}
            >
              <ChevronDownIcon size={13} />
            </button>
          ) : (
            <span className="sidebar__twisty sidebar__twisty--spacer" aria-hidden="true" />
          )}
          {renamingNoteId === note.id ? (
            <input
              className="sidebar__row-input"
              autoFocus
              value={renameNoteDraft}
              placeholder="Untitled"
              aria-label="Note name"
              onChange={(event) => setRenameNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRenameNote()
                if (event.key === 'Escape') setRenamingNoteId(null)
              }}
              onBlur={commitRenameNote}
            />
          ) : (
            <button
              type="button"
              className="sidebar__note-main"
              onClick={() => openNoteInCurrentTab(note.id)}
              onDoubleClick={() => startRenameNote(note)}
              title={
                note.title ? `${note.title} · double-click to rename` : 'Double-click to rename'
              }
            >
              <FileTextIcon size={15} />
              <span className="sidebar__label">{note.title.trim() || 'Untitled'}</span>
            </button>
          )}
          <button
            type="button"
            className="sidebar__icon-btn"
            title="Note actions"
            aria-label={`Actions for ${note.title || 'Untitled'}`}
            aria-expanded={menu?.noteId === note.id}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              if (menu?.noteId === note.id) setMenu(null)
              else openMenuAt(note.id, rect.right - 170, rect.bottom + 4)
            }}
          >
            <MoreIcon size={15} />
          </button>
        </div>
        {kids.length > 0 && isOpen && (
          <ul className="sidebar__notes sidebar__notes--nested">
            {kids.map((kid) => renderTree(kid, depth + 1, [...ancestors, note.id]))}
          </ul>
        )}
      </li>
    )
  }

  // One custom section: draggable divider header plus its notes. Dividers
  // reorder against each other; notes dropped on the header or its list get
  // filed into the section.
  const renderSection = (section: { id: string; title: string }): React.JSX.Element => {
    const roots = visibleNotes.filter((note) => sectionOf(note.id) === section.id)
    const collapsed = collapsedIds.has(section.id)
    const renaming = renamingId === section.id
    const hint = sectionDropHint?.id === section.id ? sectionDropHint : null
    return (
      <div key={section.id} className="sidebar__section-block">
        <div
          draggable={!renaming}
          onDragStart={(event) => {
            sectionDragRef.current = section.id
            setSectionDraggingId(section.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={clearSectionDrag}
          onDragOver={(event) => {
            if (sectionDragRef.current && sectionDragRef.current !== section.id) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setSectionDropHint({ id: section.id, before: positionAbove(event) })
            } else if (dragIdRef.current) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setNoteOverSection(section.id)
            }
          }}
          onDragLeave={() => setNoteOverSection(null)}
          onDrop={(event) => onSectionDrop(event, section.id)}
          className={`sidebar__divider${sectionDraggingId === section.id ? ' sidebar__divider--dragging' : ''}${hint ? (hint.before ? ' sidebar__divider--drop-before' : ' sidebar__divider--drop-after') : ''}${noteOverSection === section.id ? ' is-note-target' : ''}`}
        >
          {renaming ? (
            <input
              className="sidebar__divider-input"
              autoFocus
              value={renameDraft}
              aria-label="Section name"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') setRenamingId(null)
              }}
              onBlur={commitRename}
            />
          ) : (
            <button
              type="button"
              className="sidebar__divider-main"
              title="Collapse · double-click to rename · drag to reorder"
              onClick={() => toggleCollapsed(section.id)}
              onDoubleClick={() => {
                setRenameDraft(section.title)
                setRenamingId(section.id)
              }}
            >
              <ChevronDownIcon
                size={13}
                className={`sidebar__chevron${collapsed ? '' : ' is-open'}`}
              />
              <span className="sidebar__label">{section.title}</span>
            </button>
          )}
          <button
            type="button"
            className="sidebar__icon-btn"
            title={`Add note to ${section.title}`}
            aria-label={`Add note to ${section.title}`}
            onClick={() => createNote(undefined, section.id)}
          >
            <PlusIcon size={14} />
          </button>
          <button
            type="button"
            className="sidebar__icon-btn sidebar__icon-btn--danger"
            title={`Delete section ${section.title}`}
            aria-label={`Delete section ${section.title}`}
            onClick={() => confirmDeleteSection(section.id, section.title)}
          >
            <TrashIcon size={14} />
          </button>
        </div>
        {!collapsed && (
          <ul
            className="sidebar__notes"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onSectionListDrop(event, section.id)}
          >
            {roots.map((note) => renderTree(note, 0, []))}
          </ul>
        )}
      </div>
    )
  }

  const ungrouped = visibleNotes.filter((note) => sectionOf(note.id) === null)

  return (
    <aside
      ref={asideRef}
      className={`sidebar${resizing ? ' sidebar--resizing' : ''}${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}
      aria-label="Navigation and notes"
      aria-hidden={sidebarCollapsed || undefined}
      style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
    >
      <div className="sidebar__top">
        <label className="sidebar__search">
          <SearchIcon size={15} />
          <input
            type="search"
            className="sidebar__search-input"
            placeholder="Search or ask"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="sidebar__kbd">{IS_MAC ? '⌘K' : 'ctrl K'}</kbd>
        </label>
      </div>

      <div
        className="sidebar__scroll"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement
          if (
            target.closest(
              '[data-note-row], .sidebar__divider, .sidebar__trash-row, .sidebar__trash-head, .sidebar__events, nav, button, input, textarea, .note-menu'
            )
          ) {
            return
          }
          event.preventDefault()
          const at = clampMenu(event.clientX, event.clientY)
          setSpaceMenu(at)
        }}
      >
        <TodaySection />

        <nav className="sidebar__nav" aria-label="Primary">
          {NAV_ITEMS.filter((item) => item.key !== 'settings' && item.key !== 'graph').map(
            (item) => {
              const Icon = item.icon
              const isActive = activeTab?.kind === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`sidebar__row${isActive ? ' is-active' : ''}`}
                  onClick={() => openNav(item.key)}
                >
                  <Icon size={16} />
                  <span className="sidebar__label">{item.label}</span>
                </button>
              )
            }
          )}
        </nav>

        <div className="sidebar__section">
          <div className="sidebar__section-head">
            <span className="sidebar__section-title">Notes</span>
            <button
              type="button"
              className="sidebar__icon-btn"
              title="Open graph"
              aria-label="Open graph"
              onClick={() => openNav('graph')}
            >
              <GraphIcon size={15} />
            </button>
            <button
              type="button"
              className="sidebar__icon-btn"
              title="New note"
              aria-label="New note"
              onClick={() => createNote()}
            >
              <PlusIcon size={15} />
            </button>
          </div>

          {needle ? (
            visibleNotes.length === 0 ? (
              <p className="sidebar__empty">No notes match your search.</p>
            ) : (
              <ul
                className="sidebar__notes"
                onDragOver={(event) => event.preventDefault()}
                onDrop={onListDrop}
              >
                {visibleNotes.map((note) => renderTree(note, 0, []))}
              </ul>
            )
          ) : (
            <>
              {favoriteRoots.length > 0 && (
                <div className="sidebar__section-block" aria-label="Favorites">
                  <div className="sidebar__section-head">
                    <span className="sidebar__section-title sidebar__fav-title">
                      <StarIcon size={12} />
                      Favorites
                    </span>
                  </div>
                  <ul className="sidebar__notes">
                    {favoriteRoots.map((note) => renderTree(note, 0, []))}
                  </ul>
                </div>
              )}
              {noteSections.map((section) => renderSection(section))}
              {ungrouped.length === 0 && noteSections.length === 0 ? (
                <p className="sidebar__empty">No notes yet — create one.</p>
              ) : (
                <ul
                  className="sidebar__notes"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onListDrop}
                >
                  {ungrouped.map((note) => renderTree(note, 0, []))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {(menu || spaceMenu) && (
        <div
          className="note-menu__backdrop"
          aria-hidden="true"
          onClick={() => {
            setMenu(null)
            setSpaceMenu(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu(null)
            setSpaceMenu(null)
          }}
        />
      )}
      {spaceMenu && (
        <div
          className="note-menu note-menu--fixed"
          role="menu"
          aria-label="Notes section actions"
          style={{ left: spaceMenu.x, top: spaceMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="note-menu__item"
            onClick={() => {
              setSpaceMenu(null)
              createNote()
            }}
          >
            New page
          </button>
          <button
            type="button"
            className="note-menu__item"
            onClick={() => {
              setSpaceMenu(null)
              newSection()
            }}
          >
            New section
          </button>
          <button
            type="button"
            className="note-menu__item"
            onClick={() => {
              setSpaceMenu(null)
              expandAll()
            }}
          >
            Expand all
          </button>
          <button
            type="button"
            className="note-menu__item"
            onClick={() => {
              setSpaceMenu(null)
              collapseAll()
            }}
          >
            Collapse all
          </button>
        </div>
      )}
      {menu &&
        (() => {
          const target = notes.find((n) => n.id === menu.noteId)
          if (!target || target.deletedAt) return null
          const label = target.title.trim() || 'Untitled'
          const isFav = favorites.includes(target.id)
          return (
            <div
              className="note-menu note-menu--fixed"
              role="menu"
              aria-label={`Actions for ${label}`}
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="note-menu__item"
                onClick={() => {
                  setMenu(null)
                  openNoteNewTab(target.id)
                }}
              >
                Open in new tab
              </button>
              <button
                type="button"
                className="note-menu__item"
                onClick={() => {
                  setMenu(null)
                  splitNote(target.id)
                }}
              >
                Split view
              </button>
              <button
                type="button"
                className="note-menu__item"
                onClick={() => startRenameNote(target)}
              >
                Rename
              </button>
              <button
                type="button"
                className="note-menu__item"
                onClick={() => {
                  setMenu(null)
                  toggleFavorite(target.id)
                }}
              >
                {isFav ? 'Unfavorite' : 'Favorite'}
              </button>
              <button
                type="button"
                className="note-menu__item note-menu__item--danger"
                onClick={() => {
                  setMenu(null)
                  trashNote(target)
                }}
              >
                Delete
              </button>
            </div>
          )
        })()}
      {!needle && trashed.length > 0 && (
        <div className="sidebar__trash-footer">
          <div className="sidebar__section-block" aria-label="Trash">
            <div className="sidebar__section-head">
              <button
                type="button"
                className="sidebar__section-head--toggle sidebar__trash-head"
                aria-expanded={trashOpen}
                onClick={() => setTrashOpen((value) => !value)}
              >
                <span className="sidebar__section-title">
                  <TrashIcon size={11} />
                  Trash · {trashed.length}
                </span>
                <ChevronDownIcon
                  size={12}
                  className={`sidebar__chevron${trashOpen ? ' is-open' : ''}`}
                />
              </button>
              <button
                type="button"
                className="sidebar__empty-trash"
                title="Destroy everything in Trash forever"
                onClick={() => {
                  if (
                    window.confirm(
                      `Destroy all ${trashed.length} trashed note${trashed.length === 1 ? '' : 's'} forever? This cannot be undone.`
                    )
                  ) {
                    emptyTrash()
                  }
                }}
              >
                Empty
              </button>
            </div>
            {trashOpen &&
              trashed.map((note) => {
                const label = note.title.trim() || 'Untitled'
                return (
                  <div key={note.id} className="sidebar__trash-row" title={label}>
                    <FileTextIcon size={12} />
                    <span className="sidebar__label">{label}</span>
                    <span className="sidebar__trash-days">
                      {trashDaysLeft(note.deletedAt ?? nowMs, nowMs)} left
                    </span>
                    <button
                      type="button"
                      className="sidebar__icon-btn"
                      title={`Restore ${label}`}
                      aria-label={`Restore ${label}`}
                      onClick={() => {
                        restoreNote(note.id)
                        openNoteInCurrentTab(note.id)
                      }}
                    >
                      <RestoreIcon size={11} />
                    </button>
                    <button
                      type="button"
                      className="sidebar__icon-btn sidebar__icon-btn--danger"
                      title={`Destroy ${label} forever`}
                      aria-label={`Destroy ${label} forever`}
                      onClick={() => destroyNoteForever(note)}
                    >
                      <TrashIcon size={11} />
                    </button>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      <div className="sidebar__footer">
        <span className={`sidebar__state sidebar__state--${coreState}`} />
        <span className="sidebar__label">Core: {coreState}</span>
        <button
          type="button"
          className="sidebar__icon-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => openNav('settings')}
        >
          <SettingsIcon size={15} />
        </button>
      </div>
      <div
        className="sidebar__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize (double-click to reset)"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      />
    </aside>
  )
}

export default Sidebar
