import { useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  addDays,
  addMonths,
  formatDayLabel,
  formatTime,
  formatTimeRange,
  fromISODate,
  layoutDayColumns,
  minutesOf,
  monthGrid,
  monthLabel,
  parseISODate,
  todayISO,
  toISODate,
  toTimeString,
  weekRange
} from '../planner'
import PlannerDialog, {
  type DialogKind,
  type PlannerDialogTarget
} from '../components/PlannerDialog'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../components/icons'

type View = 'month' | 'week' | 'day'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_CELL_LIMIT = 3
const HOUR_HEIGHT = 48

interface DayEntry {
  key: string
  title: string
  kind: 'event' | 'activity' | 'todo'
  done: boolean
  startMin: number | null
  endMin: number | null
  location: string
  open: () => void
}

function Calendar(): React.JSX.Element {
  const calendarItems = useAppStore((state) => state.calendarItems)
  const todos = useAppStore((state) => state.todos)
  const plannerReady = useAppStore((state) => state.plannerReady)
  const plannerError = useAppStore((state) => state.plannerError)

  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => todayISO())
  const [dialog, setDialog] = useState<PlannerDialogTarget | null>(null)

  const today = todayISO()

  const entriesByDate = useMemo(() => {
    const map = new Map<string, DayEntry[]>()
    const push = (date: string, entry: DayEntry): void => {
      const list = map.get(date)
      if (list) list.push(entry)
      else map.set(date, [entry])
    }
    for (const item of calendarItems) {
      push(item.date, {
        key: `item-${item.id}`,
        title: item.title || 'Untitled',
        kind: item.kind,
        done: false,
        startMin: item.startTime ? minutesOf(item.startTime) : null,
        endMin: item.endTime ? minutesOf(item.endTime) : null,
        location: item.location,
        open: () => setDialog({ mode: 'edit-item', item })
      })
    }
    for (const todo of todos) {
      if (!todo.date) continue
      push(todo.date, {
        key: `todo-${todo.id}`,
        title: todo.title || 'Untitled',
        kind: 'todo',
        done: todo.done,
        startMin: todo.time ? minutesOf(todo.time) : null,
        endMin: null,
        location: todo.location,
        open: () => setDialog({ mode: 'edit-todo', item: todo })
      })
    }
    // All-day first, then by start time.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.startMin === null && b.startMin !== null) return -1
        if (a.startMin !== null && b.startMin === null) return 1
        return (a.startMin ?? 0) - (b.startMin ?? 0)
      })
    }
    return map
  }, [calendarItems, todos])

  const shift = (delta: number): void => {
    if (view === 'month') {
      const { year, month } = parseISODate(cursor)
      const next = addMonths(year, month, delta)
      setCursor(toISODate(next.year, next.month, 1))
    } else if (view === 'week') {
      setCursor(addDays(cursor, delta * 7))
    } else {
      setCursor(addDays(cursor, delta))
    }
  }

  const headerTitle = (): string => {
    if (view === 'month') {
      const { year, month } = parseISODate(cursor)
      return monthLabel(year, month)
    }
    if (view === 'week') {
      const [start, end] = [weekRange(cursor)[0], weekRange(cursor)[6]]
      const a = parseISODate(start)
      const b = parseISODate(end)
      const left = new Date(a.year, a.month - 1, 1).toLocaleString('en-US', { month: 'short' })
      const right = new Date(b.year, b.month - 1, 1).toLocaleString('en-US', {
        month: 'short'
      })
      return a.month === b.month
        ? `${left} ${a.year}`
        : `${left} ${a.day} – ${right} ${b.day}, ${b.year}`
    }
    const { year, month, day } = parseISODate(cursor)
    return `${fromISODate(cursor).toLocaleString('en-US', { weekday: 'long' })}, ${new Date(year, month - 1, day).toLocaleString('en-US', { month: 'long' })} ${day}`
  }

  const openCreate = (kind: DialogKind, date: string, startTime?: string | null): void => {
    setDialog({ mode: 'create', kind, date, startTime: startTime ?? null })
  }

  return (
    <main className="cal">
      <header className="cal__header">
        <h1 className="cal__title">{headerTitle()}</h1>
        <div className="cal__header-actions">
          <div className="cal__nav">
            <button
              type="button"
              className="cal__navbtn"
              aria-label="Previous"
              onClick={() => shift(-1)}
            >
              <ChevronLeftIcon size={16} />
            </button>
            <button
              type="button"
              className="cal__navbtn cal__today"
              onClick={() => setCursor(today)}
            >
              Today
            </button>
            <button
              type="button"
              className="cal__navbtn"
              aria-label="Next"
              onClick={() => shift(1)}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
          <div className="cal__seg" role="group" aria-label="Calendar view">
            {(['month', 'week', 'day'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`cal__seg-btn${view === value ? ' is-active' : ''}`}
                onClick={() => setView(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openCreate('event', cursor)}
          >
            <PlusIcon size={15} />
            Create
          </button>
        </div>
      </header>

      {plannerError && (
        <p className="cal__error" role="alert">
          {plannerError}
        </p>
      )}
      {!plannerReady ? (
        <p className="cal__empty">Loading calendar…</p>
      ) : view === 'month' ? (
        <MonthView
          cursor={cursor}
          today={today}
          entriesByDate={entriesByDate}
          onOpenDay={(date) => {
            setCursor(date)
            setView('day')
          }}
          onCreate={(date) => openCreate('event', date)}
        />
      ) : (
        <TimeGridView
          dates={view === 'week' ? weekRange(cursor) : [cursor]}
          today={today}
          entriesByDate={entriesByDate}
          showWeekday={view === 'week'}
          onCreate={(date, startTime) => openCreate('event', date, startTime)}
          onOpenDay={(date) => {
            setCursor(date)
            setView('day')
          }}
        />
      )}

      {dialog && <PlannerDialog target={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}

function chipClass(entry: Pick<DayEntry, 'kind' | 'done'>): string {
  return `cal-chip cal-chip--${entry.kind}${entry.done ? ' is-done' : ''}`
}

function MonthView({
  cursor,
  today,
  entriesByDate,
  onOpenDay,
  onCreate
}: {
  cursor: string
  today: string
  entriesByDate: Map<string, DayEntry[]>
  onOpenDay: (date: string) => void
  onCreate: (date: string) => void
}): React.JSX.Element {
  const { year, month } = parseISODate(cursor)
  const cells = monthGrid(year, month)
  return (
    <div className="cal-month" role="grid" aria-label="Month view">
      {WEEKDAYS.map((day) => (
        <div key={day} className="cal-dow">
          {day}
        </div>
      ))}
      {cells.map((date) => {
        const { month: cellMonth } = parseISODate(date)
        const entries = entriesByDate.get(date) ?? []
        const visible = entries.slice(0, MONTH_CELL_LIMIT)
        const extra = entries.length - visible.length
        return (
          <div
            key={date}
            role="gridcell"
            className={`cal-cell${date === today ? ' is-today' : ''}${cellMonth !== month ? ' is-dim' : ''}`}
            onClick={() => onCreate(date)}
          >
            <span className="cal-cell__date">{parseISODate(date).day}</span>
            <div className="cal-cell__entries">
              {visible.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={chipClass(entry)}
                  title={`${entry.title}${entry.location ? ` · ${entry.location}` : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    entry.open()
                  }}
                >
                  {entry.startMin !== null && (
                    <span className="cal-chip__time">
                      {formatTime(toTimeString(entry.startMin))}
                    </span>
                  )}
                  <span className="cal-chip__title">{entry.title}</span>
                </button>
              ))}
              {extra > 0 && (
                <button
                  type="button"
                  className="cal-more"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenDay(date)
                  }}
                >
                  +{extra} more
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TimeGridView({
  dates,
  today,
  entriesByDate,
  showWeekday,
  onCreate,
  onOpenDay
}: {
  dates: string[]
  today: string
  entriesByDate: Map<string, DayEntry[]>
  showWeekday: boolean
  onCreate: (date: string, startTime: string | null) => void
  onOpenDay: (date: string) => void
}): React.JSX.Element {
  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const slotTime = (event: React.MouseEvent<HTMLDivElement>): string => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 0.999)
    const total = Math.floor(ratio * 24 * 60)
    const snapped = Math.floor(total / 30) * 30
    return toTimeString(snapped)
  }

  return (
    <div className="cal-week">
      <div className="cal-week__head">
        <div className="cal-week__gutter" />
        {dates.map((date) => {
          const { day } = parseISODate(date)
          return (
            <button
              key={date}
              type="button"
              className={`cal-week__day${date === today ? ' is-today' : ''}`}
              onClick={() => showWeekday && onOpenDay(date)}
              title={showWeekday ? formatDayLabel(date) : undefined}
            >
              {showWeekday && (
                <span className="cal-week__dow">{formatDayLabel(date).split(',')[0]}</span>
              )}
              <span className="cal-week__date">{day}</span>
            </button>
          )
        })}
      </div>

      <div className="cal-week__allday">
        <div className="cal-week__gutter cal-week__gutter--label">All-day</div>
        {dates.map((date) => {
          const allDay = (entriesByDate.get(date) ?? []).filter((e) => e.startMin === null)
          return (
            <div key={date} className="cal-week__allday-col" onClick={() => onCreate(date, null)}>
              {allDay.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={chipClass(entry)}
                  onClick={(event) => {
                    event.stopPropagation()
                    entry.open()
                  }}
                >
                  <span className="cal-chip__title">{entry.title}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>

      <div className="cal-week__scroll">
        <div className="cal-grid">
          <div className="cal-grid__gutter">
            {hours.map((hour) => (
              <div key={hour} className="cal-hour" style={{ height: HOUR_HEIGHT }}>
                <span>
                  {hour === 0
                    ? ''
                    : `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`}
                </span>
              </div>
            ))}
          </div>
          {dates.map((date) => {
            const timed = (entriesByDate.get(date) ?? []).filter((e) => e.startMin !== null)
            const blocks = layoutDayColumns(timed, (entry) => ({
              startMin: entry.startMin ?? 0,
              endMin: entry.endMin ?? (entry.startMin ?? 0) + 30
            }))
            return (
              <div
                key={date}
                className="cal-col"
                style={{ height: HOUR_HEIGHT * 24 }}
                onClick={(event) => onCreate(date, slotTime(event))}
              >
                {hours.map((hour) => (
                  <div key={hour} className="cal-col__hour" style={{ height: HOUR_HEIGHT }} />
                ))}
                {date === today && (
                  <div
                    className="cal-now"
                    style={{ top: `${(nowMin / 1440) * 100}%` }}
                    title="Now"
                  />
                )}
                {blocks.map((block) => {
                  const top = (block.startMin / 1440) * 100
                  const heightPct = Math.max(((block.endMin - block.startMin) / 1440) * 100, 2.2)
                  const startLabel = toTimeString(block.startMin)
                  return (
                    <button
                      key={block.item.key}
                      type="button"
                      className={`cal-block cal-block--${block.item.kind}${block.item.done ? ' is-done' : ''}`}
                      style={{
                        top: `${top}%`,
                        height: `calc(${heightPct}% - 2px)`,
                        left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / block.lanes}% - 4px)`
                      }}
                      title={`${block.item.title} · ${formatTimeRange(startLabel, null)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        block.item.open()
                      }}
                    >
                      <span className="cal-block__title">{block.item.title}</span>
                      {block.item.location && (
                        <span className="cal-block__meta">{block.item.location}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default Calendar
