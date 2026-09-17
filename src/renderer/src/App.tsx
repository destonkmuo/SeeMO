import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import Agent from './pages/Agent'
import Home from './pages/Home'
import Note from './pages/Note'
import Section from './pages/Section'
import Settings from './pages/Settings'
import { type NavKey, useAppStore } from './store/appStore'

function Content({ active }: { active: NavKey }): React.JSX.Element {
  if (active === 'agent') return <Agent />
  if (active === 'home') return <Home />
  if (active === 'settings') return <Settings />
  return <Section section={active} />
}

function App(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Load the on-disk vault once: imports existing .md files and writes out
  // any notes that only exist in localStorage yet.
  useEffect(() => {
    void useAppStore.getState().initVault()
  }, [])

  let content: ReactNode
  if (!activeTab) {
    content = (
      <main className="empty">
        <p>No tabs open. Pick something from the sidebar.</p>
      </main>
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
        <div className="app__content">{content}</div>
      </div>
    </div>
  )
}

export default App
