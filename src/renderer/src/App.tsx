import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import AgentBubble from './components/AgentBubble'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import { XIcon } from './components/icons'
import { NAV_LABELS } from './nav'
import Agent from './pages/Agent'
import Graph from './pages/Graph'
import Home from './pages/Home'
import Note from './pages/Note'
import Section from './pages/Section'
import Settings from './pages/Settings'
import { type NavKey, type Tab, useAppStore } from './store/appStore'

/** How often auto-sync checks for unpushed vault changes. */
const AUTO_SYNC_INTERVAL_MS = 30000

function Content({ active }: { active: NavKey }): React.JSX.Element {
  if (active === 'agent') return <Agent />
  if (active === 'home') return <Home />
  if (active === 'graph') return <Graph />
  if (active === 'settings') return <Settings />
  return <Section section={active} />
}

function renderTab(tab: Tab): ReactNode {
  if (tab.kind === 'note') return <Note key={tab.id} noteId={tab.noteId} />
  return <Content active={tab.kind} />
}

function SplitPaneHeader({
  tabId,
  onClose
}: {
  tabId: string
  onClose: () => void
}): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs)
  const notes = useAppStore((state) => state.notes)
  const tab = tabs.find((t) => t.id === tabId)
  const label = !tab
    ? ''
    : tab.kind === 'note'
      ? notes.find((n) => n.id === tab.noteId)?.title.trim() || 'Untitled'
      : NAV_LABELS[tab.kind]
  return (
    <div className="pane__header">
      <span className="pane__label" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="pane__close"
        aria-label="Close split view"
        title="Close split view"
        onClick={onClose}
      >
        <XIcon size={13} />
      </button>
    </div>
  )
}

function App(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const splitTabId = useAppStore((state) => state.splitTabId)
  const setSplitTab = useAppStore((state) => state.setSplitTab)
  const autoSync = useAppStore((state) => state.autoSync)
  const vaultReady = useAppStore((state) => state.vaultReady)
  const syncingRef = useRef(false)

  // Load the on-disk vault once: imports existing .md files and writes out
  // any notes that only exist in localStorage yet.
  useEffect(() => {
    void useAppStore.getState().initVault()
  }, [])

  // Auto-sync: while enabled, periodically push unpushed vault changes.
  // Guarded against overlap; sync() itself no-ops when the tree is clean.
  useEffect(() => {
    if (!autoSync || !vaultReady) return
    const tick = (): void => {
      if (syncingRef.current) return
      syncingRef.current = true
      window.api.github
        .status()
        .then((status) => {
          if (status.remoteUrl && !status.clean) return window.api.github.sync()
          return null
        })
        .catch((error) => {
          console.error('[github] auto-sync failed', error)
        })
        .finally(() => {
          syncingRef.current = false
        })
    }
    tick()
    const timer = setInterval(tick, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [autoSync, vaultReady])

  let content: ReactNode
  const splitTab =
    splitTabId !== null && splitTabId !== activeTabId
      ? (tabs.find((t) => t.id === splitTabId) ?? null)
      : null
  if (!activeTab) {
    content = (
      <main className="empty">
        <p>No tabs open. Pick something from the sidebar.</p>
      </main>
    )
  } else if (splitTab) {
    content = (
      <>
        <div className="app__pane" key={`left-${activeTab.id}`}>
          {renderTab(activeTab)}
        </div>
        <div className="app__pane app__pane--split" key={`right-${splitTab.id}`}>
          <SplitPaneHeader tabId={splitTab.id} onClose={() => setSplitTab(null)} />
          {renderTab(splitTab)}
        </div>
      </>
    )
  } else if (activeTab.kind === 'note') {
    content = <Note key={activeTab.id} noteId={activeTab.noteId} />
  } else {
    content = <Content active={activeTab.kind} />
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="app__main">
        <TabBar />
        <div className={`app__content${splitTab ? ' app__content--split' : ''}`}>{content}</div>
      </div>
      <AgentBubble />
    </div>
  )
}

export default App
