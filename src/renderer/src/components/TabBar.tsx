import { NAV_BY_KEY, NAV_LABELS } from '../nav'
import { useAppStore } from '../store/appStore'
import { FileTextIcon, PlusIcon, XIcon } from './icons'

function TabBar(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const notes = useAppStore((state) => state.notes)
  const coreState = useAppStore((state) => state.coreState)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const closeTab = useAppStore((state) => state.closeTab)
  const createNote = useAppStore((state) => state.createNote)

  return (
    <div className="tabbar" role="tablist" aria-label="Open tabs">
      <div className="tabbar__list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const label =
            tab.kind === 'note'
              ? notes.find((n) => n.id === tab.noteId)?.title.trim() || 'Untitled'
              : NAV_LABELS[tab.kind]
          const Icon = tab.kind === 'note' ? FileTextIcon : NAV_BY_KEY[tab.kind].icon

          return (
            <div
              key={tab.id}
              className={`tab${isActive ? ' is-active' : ''}${tab.kind === 'note' ? ' tab--note' : ''}`}
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
    </div>
  )
}

export default TabBar
