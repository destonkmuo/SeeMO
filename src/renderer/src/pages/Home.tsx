import { useMemo } from 'react'
import {
  AgentIcon,
  AlarmIcon,
  CalendarIcon,
  FileTextIcon,
  GraphIcon,
  TaskIcon,
  PlusIcon,
  SettingsIcon
} from '../components/icons'
import { NAV_LABELS } from '../nav'
import { parseWikiLinks, resolveWikiTarget } from '../notes'
import { expandItemDates, todayISO } from '../planner'
import { parseStudyChild } from '../study'
import { splitHidden } from '../subpages'
import { useAppStore, type NavKey } from '../store/appStore'

function previewFor(content: string): string {
  const body = splitHidden(content).body.trim()
  const child = parseStudyChild(body)
  if (child?.type === 'flashcards') {
    return `Flashcards · ${child.cards.length} ${child.cards.length === 1 ? 'term' : 'terms'}`
  }
  if (child?.type === 'mindmap') {
    return `Mindmap · ${child.nodes.length} ${child.nodes.length === 1 ? 'node' : 'nodes'}`
  }
  if (child?.type === 'quiz') return 'Quiz · blank shell'
  return body.replace(/[#*`>_~-]/g, '').slice(0, 90) || 'Empty note'
}

interface Capability {
  key: NavKey
  title: string
  body: string
  icon: (props: { size?: number }) => React.JSX.Element
}

const CAPABILITIES: Capability[] = [
  {
    key: 'agent',
    title: 'SeeMO Agent',
    body: 'Talk or type — wake word, voice replies, and chat with memory.',
    icon: AgentIcon
  },
  {
    key: 'calendar',
    title: 'Calendar',
    body: 'Events, recurring classes, and subscribed ICS feeds in one view.',
    icon: CalendarIcon
  },
  {
    key: 'tasks',
    title: 'Tasks',
    body: 'One shared list with due dates, times, and checkboxes.',
    icon: TaskIcon
  },
  {
    key: 'graph',
    title: 'Graph',
    body: 'Your note web — nodes color-coded by links, sized by content.',
    icon: GraphIcon
  },
  {
    key: 'misc',
    title: 'Timers & Alarm',
    body: 'Alarm clock, countdown timer, and stopwatch with custom sounds.',
    icon: AlarmIcon
  },
  {
    key: 'settings',
    title: 'Vault & Backup',
    body: 'Plain markdown files on disk, GitHub sync, and app settings.',
    icon: SettingsIcon
  }
]

function Home(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const tasks = useAppStore((state) => state.tasks)
  const calendarItems = useAppStore((state) => state.calendarItems)
  const subscriptions = useAppStore((state) => state.subscriptions)
  const vaultPath = useAppStore((state) => state.vaultPath)
  const vaultReady = useAppStore((state) => state.vaultReady)
  const createNote = useAppStore((state) => state.createNote)
  const openNote = useAppStore((state) => state.openNote)
  const openNav = useAppStore((state) => state.openNav)

  const today = todayISO()

  const openTasks = useMemo(() => tasks.filter((t) => t.status !== 'completed'), [tasks])

  const dueTasks = useMemo(
    () =>
      openTasks
        .filter((t) => t.due !== null && t.due <= today)
        .sort((a, b) => {
          const left = (a.due ?? '') + (a.time ?? '')
          const right = (b.due ?? '') + (b.time ?? '')
          return left < right ? -1 : 1
        })
        .slice(0, 4),
    [openTasks, today]
  )

  const todaysEvents = useMemo(() => {
    const items = [...calendarItems]
    for (const sub of subscriptions) {
      if (sub.enabled) items.push(...sub.events)
    }
    return items
      .filter((item) => expandItemDates(item, today, today).length > 0)
      .sort((a, b) => ((a.start.dateTime ?? 'z') < (b.start.dateTime ?? 'z') ? -1 : 1))
      .slice(0, 4)
  }, [calendarItems, subscriptions, today])

  const linkCount = useMemo(() => {
    const seen = new Set<string>()
    for (const note of notes) {
      for (const link of parseWikiLinks(note.content)) {
        const targetId = resolveWikiTarget(link.target, notes)
        if (!targetId || targetId === note.id) continue
        seen.add([note.id, targetId].sort().join('|'))
      }
    }
    return seen.size
  }, [notes])

  const recent = notes
    .filter((note) => !note.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)

  const stats: { value: string; label: string }[] = [
    { value: String(notes.length), label: notes.length === 1 ? 'note' : 'notes' },
    { value: String(openTasks.length), label: 'open tasks' },
    { value: String(todaysEvents.length), label: 'events today' },
    { value: String(linkCount), label: linkCount === 1 ? 'link' : 'links' }
  ]

  return (
    <main className="home">
      <div className="home__inner">
        <header className="home__header">
          <div>
            <h1 className="home__title">SeeMO</h1>
            <p className="home__subtitle">Your notes, organized and always in motion.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => createNote()}>
            <PlusIcon size={15} />
            New note
          </button>
        </header>

        <div className="home__stats" aria-label="Library stats">
          {stats.map((stat) => (
            <div key={stat.label} className="home__stat">
              <span className="home__stat-value">{stat.value}</span>
              <span className="home__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>

        <section className="home__section" aria-label="Today at a glance">
          <h2 className="home__section-title">Today at a glance</h2>
          {todaysEvents.length === 0 && dueTasks.length === 0 ? (
            <p className="home__muted">Nothing on for today — enjoy the clear.</p>
          ) : (
            <div className="home__today">
              {todaysEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="home__today-row"
                  onClick={() => openNav('calendar')}
                >
                  <CalendarIcon size={15} />
                  <span className="home__today-text">
                    <strong>{event.summary.trim() || 'Untitled'}</strong>
                    <small>
                      {event.start.dateTime
                        ? event.start.dateTime.split('T')[1]?.slice(0, 5)
                        : 'All day'}
                      {event.location ? ` · ${event.location}` : ''}
                    </small>
                  </span>
                </button>
              ))}
              {dueTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="home__today-row"
                  onClick={() => openNav('tasks')}
                >
                  <TaskIcon size={15} />
                  <span className="home__today-text">
                    <strong>{task.title.trim() || 'Untitled'}</strong>
                    <small>
                      {task.due !== null && task.due < today
                        ? `Overdue · due ${task.due}`
                        : `Due today${task.time ? ` · ${task.time}` : ''}`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="home__section" aria-label="What SeeMO can do">
          <h2 className="home__section-title">What SeeMO can do</h2>
          <div className="home__grid">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon
              return (
                <button
                  key={cap.key}
                  type="button"
                  className="home__card"
                  onClick={() => openNav(cap.key)}
                  title={`Open ${NAV_LABELS[cap.key]}`}
                >
                  <span className="home__cap-head">
                    <Icon size={17} />
                    <span className="home__card-title">{cap.title}</span>
                  </span>
                  <span className="home__card-preview">{cap.body}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="home__section" aria-label="Recent notes">
          <h2 className="home__section-title">Recent</h2>
          {recent.length === 0 ? (
            <button type="button" className="home__empty" onClick={() => createNote()}>
              <FileTextIcon size={20} />
              <span>No notes yet. Create your first one.</span>
            </button>
          ) : (
            <div className="home__grid">
              {recent.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="home__card"
                  onClick={() => openNote(note.id)}
                >
                  <span className="home__card-title">{note.title.trim() || 'Untitled'}</span>
                  <span className="home__card-preview">{previewFor(note.content)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <p className="home__vault">
          Vault: {vaultPath ?? 'not chosen yet'} · {vaultReady ? 'ready' : 'loading…'}
        </p>
      </div>
    </main>
  )
}

export default Home
