/**
 * Recurrence (RFC 5545 RRULE subset) — build, parse, and expand.
 *
 * Stored as Google-Calendar-style strings (`["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]`)
 * so events transfer to/from Google and ICS feeds unchanged.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL,
 * BYDAY (weekly; monthly/yearly narrowing), plus EXDATE exceptions.
 * Not supported (documented limitation): BYSETPOS, BYMONTH, and full TZID
 * handling — times are treated as floating local times.
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

export interface Recurrence {
  freq: Freq
  interval: number
  /** Weekday codes (SU..SA); empty means "same weekday as the start". */
  byDay: string[]
  count: number | null
  /** Inclusive last date `YYYY-MM-DD`. */
  until: string | null
}

/** Upper bound on generated occurrences per rule, to keep expansion bounded. */
const MAX_ITERATIONS = 2000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Compare two `YYYY-MM-DD` strings. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildRRule(rec: Recurrence): string {
  const parts = [`FREQ=${rec.freq}`]
  if (rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`)
  if (rec.freq === 'WEEKLY' && rec.byDay.length > 0) {
    const order = (code: string): number => (WEEKDAYS as readonly string[]).indexOf(code)
    parts.push(`BYDAY=${[...rec.byDay].sort((a, b) => order(a) - order(b)).join(',')}`)
  }
  if (rec.count && rec.count > 0) parts.push(`COUNT=${rec.count}`)
  else if (rec.until) parts.push(`UNTIL=${rec.until.replace(/-/g, '')}`)
  return `RRULE:${parts.join(';')}`
}

export function parseRRule(rule: string): Recurrence | null {
  const body = rule.replace(/^RRULE:/i, '')
  const map = new Map<string, string>()
  for (const chunk of body.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq > 0) map.set(chunk.slice(0, eq).toUpperCase(), chunk.slice(eq + 1))
  }
  const freq = (map.get('FREQ') ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null
  }
  const interval = Math.max(1, Number(map.get('INTERVAL') ?? '1') || 1)
  const byDay = (map.get('BYDAY') ?? '')
    .split(',')
    .map((d) => d.trim().toUpperCase().slice(-2))
    .filter((d): d is string => (WEEKDAYS as readonly string[]).includes(d))
  const countRaw = Number(map.get('COUNT') ?? '')
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : null
  let until: string | null = null
  const untilRaw = map.get('UNTIL')
  if (untilRaw && /^\d{8}/.test(untilRaw)) {
    until = `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`
  }
  return { freq, interval, byDay, count, until }
}

/**
 * Expand a rule into the concrete dates it lands on inside `[rangeStart,
 * rangeEnd]`, inclusive. Always bounded by MAX_ITERATIONS so a malformed or
 * enormous rule can never hang the UI.
 */
export function expandRecurrence(
  startDate: string,
  rule: string,
  rangeStart: string,
  rangeEnd: string,
  exdates: string[] = []
): string[] {
  const rec = parseRRule(rule)
  if (!rec) return []
  const excluded = new Set(exdates)
  const out: string[] = []
  let emitted = 0
  let stopped = false

  // Decide what to do with the next occurrence in series order.
  const visit = (iso: string): void => {
    if (stopped) return
    if (rec.until && cmp(iso, rec.until) > 0) {
      stopped = true
      return
    }
    if (cmp(iso, rangeEnd) > 0) {
      stopped = true
      return
    }
    emitted += 1
    if (rec.count !== null && emitted > rec.count) {
      stopped = true
      return
    }
    if (cmp(iso, rangeStart) >= 0 && !excluded.has(iso)) out.push(iso)
  }

  if (rec.freq === 'WEEKLY' && rec.byDay.length > 0) {
    // Anchor to the Sunday of the start week, then walk whole weeks so the
    // selected weekdays come out in chronological order.
    const base = fromISO(startDate)
    base.setDate(base.getDate() - base.getDay())
    for (let week = 0; week < MAX_ITERATIONS && !stopped; week++) {
      const anchor = new Date(base)
      anchor.setDate(anchor.getDate() + week * 7 * rec.interval)
      for (let offset = 0; offset < 7 && !stopped; offset++) {
        const date = new Date(anchor)
        date.setDate(date.getDate() + offset)
        const iso = toISO(date)
        if (cmp(iso, startDate) < 0) continue
        if (!rec.byDay.includes(WEEKDAYS[date.getDay()])) continue
        visit(iso)
      }
    }
    return out
  }

  // Daily / weekly-same-weekday / monthly / yearly: compute the i-th
  // occurrence from the series start rather than stepping a mutable cursor —
  // stepping loses the original day-of-month once a month clamps (Jan 31 ->
  // Feb 28 would otherwise stay on the 28th forever).
  const origin = fromISO(startDate)
  const startYear = origin.getFullYear()
  const startMonth = origin.getMonth()
  const startDay = origin.getDate()

  for (let i = 0; i < MAX_ITERATIONS && !stopped; i++) {
    const date = new Date(startYear, startMonth, startDay)
    if (rec.freq === 'DAILY') {
      date.setDate(date.getDate() + i * rec.interval)
    } else if (rec.freq === 'WEEKLY') {
      date.setDate(date.getDate() + i * 7 * rec.interval)
    } else if (rec.freq === 'MONTHLY') {
      date.setDate(1)
      date.setMonth(date.getMonth() + i * rec.interval)
      date.setDate(
        Math.min(startDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())
      )
    } else {
      date.setDate(1)
      date.setFullYear(date.getFullYear() + i * rec.interval)
      date.setMonth(startMonth)
      date.setDate(Math.min(startDay, new Date(date.getFullYear(), startMonth + 1, 0).getDate()))
    }
    visit(toISO(date))
  }
  return out
}

/** Human summary, e.g. "Weekly on Mon, Wed". */
export function describeRecurrence(rule: string): string {
  const rec = parseRRule(rule)
  if (!rec) return 'Repeats'
  const every = rec.interval > 1 ? `every ${rec.interval} ` : ''
  const names: Record<string, string> = {
    SU: 'Sun',
    MO: 'Mon',
    TU: 'Tue',
    WE: 'Wed',
    TH: 'Thu',
    FR: 'Fri',
    SA: 'Sat'
  }
  if (rec.freq === 'DAILY') return `Every ${every}day`.replace('Every day', 'Daily')
  if (rec.freq === 'WEEKLY') {
    const days = rec.byDay.map((d) => names[d]).join(', ')
    return days ? `Weekly${every ? ` (${every.trim()})` : ''} on ${days}` : 'Weekly'
  }
  if (rec.freq === 'MONTHLY') return `Monthly${every ? ` (${every.trim()})` : ''}`
  return `Yearly${every ? ` (${every.trim()})` : ''}`
}
