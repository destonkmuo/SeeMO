import { useMemo, useRef, useState } from 'react'
import { NAV_ITEMS } from '../nav'
import { buildNoteGraph, orderedNotes } from '../notes'
import { SIDEBAR_DEFAULT_WIDTH, clampSidebarWidth, useAppStore, type Note } from '../store/appStore'
import {
  CalendarIcon,
  ChevronDownIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon
} from './icons'

function UpcomingEvents(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const openNav = useAppStore((state) => state.openNav)

  return (
    <section className="sidebar__events" aria-label="Upcoming events">
      <button
        type="button"
        className="sidebar__section-head sidebar__section-head--toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sidebar__section-title">Upcoming events</span>
        <ChevronDownIcon size={14} className={`sidebar__chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <button type="button" className="sidebar__connect" onClick={() => openNav('calendar')}>
          <CalendarIcon size={16} />
          <span className="sidebar__connect-text">
            <strong>Connect your calendar</strong>
            <small>See all your events and start meeting notes for them.</small>
          </span>
        </button>
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
  const openNote = useAppStore((state) => state.openNote)
  const setQuery = useAppStore((state) => state.setQuery)
  const createNote = useAppStore((state) => state.createNote)
  const deleteNote = useAppStore((state) => state.deleteNote)
  const moveNote = useAppStore((state) => state.moveNote)
  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; before: boolean } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [resizing, setResizing] = useState(false)
  const dragIdRef = useRef<string | null>(null)
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
  const graph = useMemo(() => buildNoteGraph(orderedNotes(notes, noteOrder)), [notes, noteOrder])
  const visibleNotes = (needle ? orderedNotes(notes, noteOrder) : graph.roots).filter(matchesQuery)

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
    if (dragId && dragId !== noteId) moveNote(dragId, noteId, positionFromEvent(event))
  }

  const onListDrop = (event: React.DragEvent<HTMLUListElement>): void => {
    // Only fires for empty list space; note drops stop propagation above.
    event.preventDefault()
    const dragId = dragIdRef.current
    clearDrag()
    if (dragId) moveNote(dragId, null, false)
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
            onDragEnd: clearDrag,
            onDragOver: (event: React.DragEvent<HTMLLIElement>): void => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dragIdRef.current && dragIdRef.current !== note.id) {
                setDropHint({ id: note.id, before: positionFromEvent(event) })
              }
            },
            onDrop: (event: React.DragEvent<HTMLLIElement>): void => onNoteDrop(event, note.id)
          }
        : {}
    return (
      <li
        key={note.id}
        {...dragAttrs}
        className={`sidebar__note${draggingId === note.id && depth === 0 ? ' sidebar__note--dragging' : ''}${hint ? (hint.before ? ' sidebar__note--drop-before' : ' sidebar__note--drop-after') : ''}`}
      >
        <div
          className={`sidebar__row sidebar__row--note${
            activeNoteId === note.id ? ' is-active' : ''
          }`}
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
          <button
            type="button"
            className="sidebar__note-main"
            onClick={() => openNote(note.id)}
            title={note.title || 'Untitled'}
          >
            <FileTextIcon size={15} />
            <span className="sidebar__label">{note.title.trim() || 'Untitled'}</span>
          </button>
          <button
            type="button"
            className="sidebar__icon-btn sidebar__icon-btn--danger"
            title="Delete note"
            aria-label={`Delete ${note.title || 'Untitled'}`}
            onClick={() => deleteNote(note.id)}
          >
            <TrashIcon size={14} />
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

  return (
    <aside
      ref={asideRef}
      className={`sidebar${resizing ? ' sidebar--resizing' : ''}`}
      aria-label="Navigation and notes"
      style={{ width: sidebarWidth }}
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
          <kbd className="sidebar__kbd">⌘K</kbd>
        </label>
      </div>

      <div className="sidebar__scroll">
        <UpcomingEvents />

        <nav className="sidebar__nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
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
          })}
        </nav>

        <div className="sidebar__section">
          <div className="sidebar__section-head">
            <span className="sidebar__section-title">Notes</span>
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

          {visibleNotes.length === 0 ? (
            <p className="sidebar__empty">
              {needle ? 'No notes match your search.' : 'No notes yet — create one.'}
            </p>
          ) : (
            <ul
              className="sidebar__notes"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onListDrop}
            >
              {visibleNotes.map((note) => renderTree(note, 0, []))}
            </ul>
          )}
        </div>
      </div>

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
