/**
 * Planner data model + pure helpers for the calendar and todo list.
 *
 * Everything is stored as plain JSON arrays in the vault (`calendar.json`
 * and `todo.json`). Dates are local `YYYY-MM-DD` strings and times are
 * `HH:MM` strings, so no timezone math ever leaks into the UI.
 */

export type PlannerKind = 'event' | 'activity'

export interface CalendarItem {
  id: string
  kind: PlannerKind
  title: string
  description: string
  location: string
  /** Local date `YYYY-MM-DD`. */
  date: string
  /** `HH:MM` or null for all-day. */
  startTime: string | null
  /** `HH:MM` or null (open-ended / all-day). */
  endTime: string | null
  createdAt: number
  updatedAt: number
}

export interface TodoItem {
  id: string
  title: string
  description: string
  location: string
  /** Due/scheduled date `YYYY-MM-DD`, or null for unscheduled. */
  date: string | null
  /** `HH:MM` or null. */
  time: string | null
  done: boolean
  createdAt: number
  updatedAt: number
}

export const CALENDAR_FILE = 'calendar.json'
export const TODO_FILE = 'todo.json'

/** Field shapes for the create/edit dialog (ids + timestamps assigned on save). */
export interface CalendarDraft {
  kind: PlannerKind
  title: string
  description: string
  location: string
  date: string
  startTime: string | null
  endTime: string | null
}

export interface TodoDraft {
  title: string
  description: string
  location: string
  date: string | null
  time: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null
}

function asTime(value: unknown): string | null {
  return typeof value === 'string' && TIME_RE.test(value) ? value : null
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Coerce one raw JSON value into a CalendarItem, or null when unusable. */
export function toCalendarItem(value: unknown, now: number): CalendarItem | null {
  if (!isRecord(value)) return null
  const id = asId(value.id)
  const date = asDate(value.date)
  if (!id || !date) return null
  const kind = value.kind === 'activity' ? 'activity' : 'event'
  return {
    id,
    kind,
    title: asString(value.title),
    description: asString(value.description),
    location: asString(value.location),
    date,
    startTime: asTime(value.startTime),
    endTime: asTime(value.endTime),
    createdAt: asNumber(value.createdAt, now),
    updatedAt: asNumber(value.updatedAt, now)
  }
}

/** Coerce one raw JSON value into a TodoItem, or null when unusable. */
export function toTodoItem(value: unknown, now: number): TodoItem | null {
  if (!isRecord(value)) return null
  const id = asId(value.id)
  if (!id) return null
  return {
    id,
    title: asString(value.title),
    description: asString(value.description),
    location: asString(value.location),
    date: asDate(value.date),
    time: asTime(value.time),
    done: value.done === true,
    createdAt: asNumber(value.createdAt, now),
    updatedAt: asNumber(value.updatedAt, now)
  }
}

export function parseCalendarItems(data: unknown): CalendarItem[] {
  if (!Array.isArray(data)) return []
  const now = Date.now()
  const items: CalendarItem[] = []
  for (const value of data) {
    const item = toCalendarItem(value, now)
    if (item) items.push(item)
  }
  return items
}

export function parseTodoItems(data: unknown): TodoItem[] {
  if (!Array.isArray(data)) return []
  const now = Date.now()
  const items: TodoItem[] = []
  for (const value of data) {
    const item = toTodoItem(value, now)
    if (item) items.push(item)
  }
  return items
}

// ---------------------------------------------------------------------------
// Local-date helpers (month is 1-12; weeks start Sunday like Google US).
// ---------------------------------------------------------------------------

export function toISODate(year: number, month: number, day: number): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

export function todayISO(): string {
  const now = new Date()
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parseISODate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

export function fromISODate(iso: string): Date {
  const { year, month, day } = parseISODate(iso)
  return new Date(year, month - 1, day)
}

export function addDays(iso: string, days: number): string {
  const date = fromISODate(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function addMonths(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 42 cells (6 weeks) covering the month, starting Sunday. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1)
  const startOffset = first.getDay()
  const cells: string[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(year, month - 1, 1 + i - startOffset)
    cells.push(toISODate(date.getFullYear(), date.getMonth() + 1, date.getDate()))
  }
  return cells
}

/** 7-day week (Sunday-first) containing the given date. */
export function weekRange(iso: string): string[] {
  const date = fromISODate(iso)
  const start = addDays(iso, -date.getDay())
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

/** `2026-09-17` -> `Thu, Sep 17`. */
export function formatDayLabel(iso: string): string {
  const date = fromISODate(iso)
  const weekday = date.toLocaleString('en-US', { weekday: 'short' })
  const rest = date.toLocaleString('en-US', { month: 'short', day: 'numeric' })
  return `${weekday}, ${rest}`
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** `485` -> `08:05`. Wraps past midnight. */
export function toTimeString(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

/** `13:05` -> `1:05 PM`; midnight/noon handled. */
export function formatTime(time: string): string {
  const total = minutesOf(time)
  const hours24 = Math.floor(total / 60)
  const minutes = total % 60
  const suffix = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

export function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return 'All day'
  if (!end || end <= start) return formatTime(start)
  return `${formatTime(start)} – ${formatTime(end)}`
}

// ---------------------------------------------------------------------------
// Day-column layout: overlapping timed items share columns side by side.
// ---------------------------------------------------------------------------

export interface TimedBlock<T> {
  item: T
  startMin: number
  endMin: number
  /** 0-based lane within its overlap cluster. */
  lane: number
  /** Lane count of its overlap cluster. */
  lanes: number
}

interface Bound {
  startMin: number
  endMin: number
}

function overlaps(a: Bound, b: Bound): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin
}

/**
 * Assign lanes so overlapping blocks sit side by side. Returns blocks in
 * input order. Zero/negative durations are treated as 30-minute blocks.
 */
export function layoutDayColumns<T>(items: T[], boundsOf: (item: T) => Bound): TimedBlock<T>[] {
  const withBounds = items.map((item, index) => {
    const bounds = boundsOf(item)
    const startMin = bounds.startMin
    const endMin = Math.max(bounds.endMin, startMin + 30)
    return { item, index, startMin, endMin }
  })
  const order = withBounds
    .map((entry, position) => ({ entry, position }))
    .sort((a, b) => a.entry.startMin - b.entry.startMin || a.entry.endMin - b.entry.endMin)

  // Split into clusters where every member transitively overlaps. All
  // overlapping clusters merge so a bridging event unites them.
  const clusters: (typeof withBounds)[] = []
  for (const { entry } of order) {
    const hits = clusters.filter((members) => members.some((m) => overlaps(m, entry)))
    if (hits.length === 0) {
      clusters.push([entry])
    } else {
      const [first, ...rest] = hits
      first.push(entry)
      for (const other of rest) {
        first.push(...other)
        clusters.splice(clusters.indexOf(other), 1)
      }
    }
  }

  const placed = new Map<number, { lane: number; lanes: number }>()
  for (const cluster of clusters) {
    const laneEnds: number[] = []
    const byStart = cluster.slice().sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    for (const entry of byStart) {
      let lane = laneEnds.findIndex((end) => end <= entry.startMin)
      if (lane < 0) {
        lane = laneEnds.length
        laneEnds.push(entry.endMin)
      } else {
        laneEnds[lane] = entry.endMin
      }
      placed.set(entry.index, { lane, lanes: 0 })
    }
    for (const entry of cluster) {
      const slot = placed.get(entry.index)
      if (slot) slot.lanes = laneEnds.length
    }
  }

  return withBounds.map(({ item, index, startMin, endMin }) => {
    const slot = placed.get(index) ?? { lane: 0, lanes: 1 }
    return { item, startMin, endMin, lane: slot.lane, lanes: slot.lanes }
  })
}
