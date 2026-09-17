/**
 * Tiny pure time helpers shared by the Misc mini-apps (alarm, timer,
 * stopwatch). Dependency-free so they stay unit-testable.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTimeHHMM(value: string): boolean {
  return TIME_RE.test(value)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Current local time as `HH:MM`. */
export function nowHHMM(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** True when the clock currently shows the alarm time (minute precision). */
export function isAlarmDue(alarmTime: string, now: Date = new Date()): boolean {
  return isValidTimeHHMM(alarmTime) && nowHHMM(now) === alarmTime
}

/** `HH:MM` + minutes, wrapping past midnight. Returns null on bad input. */
export function addMinutesHHMM(time: string, minutes: number): string | null {
  if (!isValidTimeHHMM(time)) return null
  const [h, m] = time.split(':').map(Number)
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** Parse `MM:SS` or `M:SS` (also bare minutes like `5`) into total seconds. */
export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim()
  if (/^\d{1,4}$/.test(trimmed)) {
    const minutes = Number(trimmed)
    return minutes > 0 && minutes <= 999 ? minutes * 60 : null
  }
  const match = /^(\d{1,3}):([0-5]?\d)$/.exec(trimmed)
  if (!match) return null
  const total = Number(match[1]) * 60 + Number(match[2])
  return total > 0 && total <= 59999 ? total : null
}

/** Seconds -> `MM:SS` (hours fold into minutes). */
export function formatElapsed(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  return `${pad(minutes)}:${pad(clamped % 60)}`
}
