import { useRef, useState } from 'react'
import { NAV_BY_KEY, NAV_LABELS } from '../nav'
import { useAppStore } from '../store/appStore'
import {
  FileTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClearAllIcon,
  PlusIcon,
  SplitIcon,
  XIcon
} from './icons'

interface DropHint {
  id: string
  before: boolean
}

function TabBar(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const notes = useAppStore((state) => state.notes)
  const coreState = useAppStore((state) => state.coreState)
  const tabHistory = useAppStore((state) => state.tabHistory)
  const historyIndex = useAppStore((state) => state.historyIndex)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const goBackTab = useAppStore((state) => state.goBackTab)
  const goForwardTab = useAppStore((state) => state.goForwardTab)
  const closeTab = useAppStore((state) => state.closeTab)
  const moveTab = useAppStore((state) => state.moveTab)
  const setSplitTab = useAppStore((state) => state.setSplitTab)
  const closeAllTabs = useAppStore((state) => state.closeAllTabs)
  const createNote = useAppStore((state) => state.createNote)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const dragIdRef = useRef<string | null>(null)

  // Browser-style history: Back revisits the previously active tab,
  // Forward redoes it. New visits truncate the forward trail.
  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex >= 0 && historyIndex < tabHistory.length - 1

  const clearDrag = (): void => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropHint(null)
  }

  // Which side of the hovered tab the dragged tab would land on.
  const positionFromEvent = (event: React.DragEvent<HTMLDivElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientX - rect.left < rect.width / 2
  }

  const onTabDrop = (event: React.DragEvent<HTMLDivElement>, tabId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const dragId = dragIdRef.current
    clearDrag()
    if (dragId && dragId !== tabId) moveTab(dragId, tabId, positionFromEvent(event))
  }

  const onListDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    // Only fires for empty bar space; tab drops stop propagation above.
    event.preventDefault()
    const dragId = dragIdRef.current
    clearDrag()
    if (dragId) moveTab(dragId, null, false)
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Open tabs">
      <div className="tabbar__nav" role="group" aria-label="Switch tabs">
        <button
          type="button"
          className="tabbar__new"
          title="Back to the previous tab"
          aria-label="Back to the previous tab"
          disabled={!canGoBack}
          onClick={() => goBackTab()}
        >
          <ChevronLeftIcon size={15} />
        </button>
        <button
          type="button"
          className="tabbar__new"
          title="Forward to the next tab"
          aria-label="Forward to the next tab"
          disabled={!canGoForward}
          onClick={() => goForwardTab()}
        >
          <ChevronRightIcon size={15} />
        </button>
      </div>
      <div
        className="tabbar__list"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onListDrop}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const label =
            tab.kind === 'note'
              ? notes.find((n) => n.id === tab.noteId)?.title.trim() || 'Untitled'
              : NAV_LABELS[tab.kind]
          const Icon = tab.kind === 'note' ? FileTextIcon : NAV_BY_KEY[tab.kind].icon
          const hint = dropHint?.id === tab.id ? dropHint : null

          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(event) => {
                dragIdRef.current = tab.id
                setDraggingId(tab.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={clearDrag}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (dragIdRef.current && dragIdRef.current !== tab.id) {
                  setDropHint({ id: tab.id, before: positionFromEvent(event) })
                }
              }}
              onDrop={(event) => onTabDrop(event, tab.id)}
              className={`tab${isActive ? ' is-active' : ''}${tab.kind === 'note' ? ' tab--note' : ''}${draggingId === tab.id ? ' tab--dragging' : ''}${hint ? (hint.before ? ' tab--drop-before' : ' tab--drop-after') : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="tab__main"
                title={label}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={14} />
                {tab.kind === 'agent' && (
                  <span
                    className={`tab__dot tab__dot--${coreState}`}
                    title={`Core: ${coreState}`}
                  />
                )}
                <span className="tab__label">{label}</span>
              </button>
              <button
                type="button"
                className="tab__split"
                aria-label={`Split view with ${label}`}
                title={`Split view with ${label}`}
                onClick={() => {
                  if (tab.id !== activeTabId) setSplitTab(tab.id)
                }}
              >
                <SplitIcon size={13} />
              </button>
              <button
                type="button"
                className="tab__close"
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
                onClick={() => closeTab(tab.id)}
              >
                <XIcon size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="tabbar__new"
        title="New note"
        aria-label="New note"
        onClick={() => createNote()}
      >
        <PlusIcon size={15} />
      </button>
      <button
        type="button"
        className="tabbar__new"
        title="Clear all tabs"
        aria-label="Clear all tabs"
        disabled={tabs.length === 0}
        onClick={() => closeAllTabs()}
      >
        <ClearAllIcon size={15} />
      </button>
    </div>
  )
}

export default TabBar
