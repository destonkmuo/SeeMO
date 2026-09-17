import { useState } from 'react'
import { NAV_ITEMS } from '../nav'
import { useAppStore } from '../store/appStore'
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
  const query = useAppStore((state) => state.query)
  const coreState = useAppStore((state) => state.coreState)
  const openNav = useAppStore((state) => state.openNav)
  const openNote = useAppStore((state) => state.openNote)
  const setQuery = useAppStore((state) => state.setQuery)
  const createNote = useAppStore((state) => state.createNote)
  const deleteNote = useAppStore((state) => state.deleteNote)

  const activeNoteId = activeTab?.kind === 'note' ? activeTab.noteId : null
  const needle = query.trim().toLowerCase()
  const visibleNotes = (
    needle
      ? notes.filter(
          (n) => n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle)
        )
      : notes
  )
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <aside className="sidebar" aria-label="Navigation and notes">
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
            <ul className="sidebar__notes">
              {visibleNotes.map((note) => (
                <li key={note.id}>
                  <div
                    className={`sidebar__row sidebar__row--note${
                      activeNoteId === note.id ? ' is-active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="sidebar__icon-btn sidebar__icon-btn--danger"
                      title="Delete note"
                      aria-label={`Delete ${note.title || 'Untitled'}`}
                      onClick={() => deleteNote(note.id)}
                    >
                      <TrashIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="sidebar__note-main"
                      onClick={() => openNote(note.id)}
                      title={note.title || 'Untitled'}
                    >
                      <span className="sidebar__label">{note.title.trim() || 'Untitled'}</span>
                      <FileTextIcon size={15} />
                    </button>
                  </div>
                </li>
              ))}
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
    </aside>
  )
}

export default Sidebar
