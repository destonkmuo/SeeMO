import type { EventDateTime } from './planner'

/**
 * Minimal iCalendar (RFC 5545) reader for calendar subscriptions.
 *
 * Handles the subset that real-world feeds rely on: line unfolding, property
 * parameters, escaped text, DATE vs DATE-TIME values, UTC (`Z`) times,
 * DURATION, RRULE and EXDATE.
 *
 * Documented limitation: `TZID` wall-clock times are treated as floating
 * local times (no tz database), so an event in another timezone shows at its
 * stated wall time rather than being converted.
 */

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  location: string
  start: EventDateTime
  end: EventDateTime | null
  /** Google-style rule lines, e.g. `RRULE:FREQ=WEEKLY;BYDAY=MO`. */
  recurrence: string[]
  /** Exception dates as `YYYY-MM-DD`. */
  exdates: string[]
}

/** Bound parsed events so a hostile/huge feed can't exhaust memory. */
const MAX_EVENTS = 5000

interface Prop {
  name: string
  params: Map<string, string>
  value: string
}

/** RFC 5545 line unfolding: a CRLF followed by space/tab continues the line. */
export function unfoldLines(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r\n|\n|\r/)
}

function parseProp(line: string): Prop | null {
  // NAME;PARAM=VAL:VALUE — the first colon outside the name/params splits it.
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const segments = head.split(';')
  const name = segments[0].trim().toUpperCase()
  const params = new Map<string, string>()
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=')
    if (eq > 0) params.set(segment.slice(0, eq).toUpperCase(), segment.slice(eq + 1))
  }
  return { name, params, value }
}

/** Undo RFC 5545 text escaping. */
export function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * `20260914T090000` / `20260914T090000Z` / `20260914` -> our EventDateTime.
 * `VALUE=DATE` and bare 8-digit values are treated as all-day.
 */
export function parseIcsDate(value: string, params: Map<string, string>): EventDateTime | null {
  const raw = value.trim()
  const isDate = params.get('VALUE')?.toUpperCase() === 'DATE' || /^\d{8}$/.test(raw)
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
    if (!m) return null
    return { date: `${m[1]}-${m[2]}-${m[3]}` }
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw)
  if (!m) return null
  const [, y, mo, d, h, mi, , zulu] = m
  if (zulu) {
    // UTC -> floating local, so the value matches the user's clock.
    const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)))
    return {
      dateTime: `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}T${pad(utc.getHours())}:${pad(utc.getMinutes())}`
    }
  }
  // Floating, or TZID wall time (treated as local).
  return { dateTime: `${y}-${mo}-${d}T${h}:${mi}` }
}

/** ISO-8601 duration (e.g. `PT1H30M`, `P1D`) -> minutes. */
export function parseDurationMinutes(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim()
  )
  if (!m) return null
  const [, sign, w, d, h, mi, s] = m
  if (!w && !d && !h && !mi && !s) return null
  const total =
    (Number(w ?? 0) * 7 + Number(d ?? 0)) * 1440 +
    Number(h ?? 0) * 60 +
    Number(mi ?? 0) +
    Math.round(Number(s ?? 0) / 60)
  return sign === '-' ? -total : total
}

function addMinutesToDateTime(dt: EventDateTime, minutes: number): EventDateTime | null {
  if (dt.date) {
    const [y, m, d] = dt.date.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() + Math.round(minutes / 1440))
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
  }
  if (!dt.dateTime) return null
  const [datePart, timePart] = dt.dateTime.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const date = new Date(y, m - 1, d, hh, mm + minutes)
  return {
    dateTime: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}

function dateOnly(dt: EventDateTime): string | null {
  if (dt.date) return dt.date
  return dt.dateTime ? dt.dateTime.slice(0, 10) : null
}

/** Parse an ICS document into events (VEVENTs only). */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfoldLines(text)
  const events: IcsEvent[] = []
  let current: {
    uid: string
    summary: string
    description: string
    location: string
    start: EventDateTime | null
    end: EventDateTime | null
    durationMinutes: number | null
    recurrence: string[]
    exdates: string[]
  } | null = null
  let index = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.toUpperCase() === 'BEGIN:VEVENT') {
      current = {
        uid: '',
        summary: '',
        description: '',
        location: '',
        start: null,
        end: null,
        durationMinutes: null,
        recurrence: [],
        exdates: []
      }
      continue
    }
    if (trimmed.toUpperCase() === 'END:VEVENT') {
      if (current?.start && events.length < MAX_EVENTS) {
        const end =
          current.end ??
          (current.durationMinutes != null
            ? addMinutesToDateTime(current.start, current.durationMinutes)
            : null)
        events.push({
          uid: current.uid || `ics-${index}`,
          summary: current.summary,
          description: current.description,
          location: current.location,
          start: current.start,
          end,
          recurrence: current.recurrence,
          exdates: current.exdates
        })
        index += 1
      }
      current = null
      continue
    }
    if (!current) continue

    const prop = parseProp(trimmed)
    if (!prop) continue
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value.trim()
        break
      case 'SUMMARY':
        current.summary = unescapeText(prop.value)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value)
        break
      case 'LOCATION':
        current.location = unescapeText(prop.value)
        break
      case 'DTSTART':
        current.start = parseIcsDate(prop.value, prop.params)
        break
      case 'DTEND':
        current.end = parseIcsDate(prop.value, prop.params)
        break
      case 'DURATION':
        current.durationMinutes = parseDurationMinutes(prop.value)
        break
      case 'RRULE':
        current.recurrence.push(`RRULE:${prop.value.trim().toUpperCase()}`)
        break
      case 'EXDATE': {
        for (const part of prop.value.split(',')) {
          const parsed = parseIcsDate(part, prop.params)
          const date = parsed ? dateOnly(parsed) : null
          if (date) current.exdates.push(date)
        }
        break
      }
      default:
        break
    }
  }
  return events
}
