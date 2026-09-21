import { useEffect, useState } from 'react'
import { BUILT_IN_SOUNDS, previewSound, resolveSoundUrl, stopAlarm } from '../alarm'
import { AlarmIcon, PlusIcon, StopwatchIcon, TimerIcon, XIcon } from '../components/icons'
import {
  useAppStore,
  type AlarmItem,
  type PomodoroPhase,
  type PomodoroState,
  type StopwatchItem,
  type TimerItem
} from '../store/appStore'
import { addMinutesHHMM, formatElapsed, formatTime12h, nowHHMM, parseDurationInput } from '../time'

/** Re-render on a heartbeat so countdown/stopwatch faces stay live. */
function useNowMs(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs)
    return () => clearInterval(id)
  }, [stepMs])
  return now
}

/** Stop the shared loop only when nothing is still ringing. */
function silenceUnlessRinging(): void {
  const state = useAppStore.getState()
  const ringing =
    state.alarms.some((alarm) => alarm.ringing) ||
    state.timers.some((timer) => timer.ringing) ||
    state.pomodoro.ringing
  if (!ringing) stopAlarm()
}

function formatDurationDraft(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function SoundSelect({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (id: string) => void
  label: string
}): React.JSX.Element {
  const customAlarm = useAppStore((state) => state.customAlarm)
  return (
    <select
      className="dlg__input"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {BUILT_IN_SOUNDS.map((sound) => (
        <option key={sound.id} value={sound.id}>
          {sound.label}
        </option>
      ))}
      {customAlarm && <option value="custom">Custom: {customAlarm.name}</option>}
    </select>
  )
}

function DeleteButton({
  label,
  onDelete
}: {
  label: string
  onDelete: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="miniapp__delete"
      title={`Delete ${label}`}
      aria-label={`Delete ${label}`}
      onClick={onDelete}
    >
      <XIcon size={13} />
    </button>
  )
}

function SoundSettings(): React.JSX.Element {
  const alarmSoundId = useAppStore((state) => state.alarmSoundId)
  const setAlarmSoundId = useAppStore((state) => state.setAlarmSoundId)
  const customAlarm = useAppStore((state) => state.customAlarm)
  const setCustomAlarm = useAppStore((state) => state.setCustomAlarm)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const soundUrl = resolveSoundUrl(alarmSoundId, customAlarm?.url ?? null)

  const uploadCustom = async (): Promise<void> => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await window.api.importAlarmSound()
      if (!result) return // user canceled the picker
      setCustomAlarm({ name: result.name, url: result.url })
      setAlarmSoundId('custom')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import sound.')
    } finally {
      setUploading(false)
    }
  }

  const onSelectSound = (id: string): void => {
    if (id === 'custom' && !customAlarm) {
      void uploadCustom()
      return
    }
    setAlarmSoundId(id)
  }

  return (
    <div className="miniapp miniapp--wide" aria-label="Alarm sound">
      <div className="miniapp__row">
        <span className="miniapp__hint">Default sound for new alarms &amp; timers:</span>
        <select
          className="dlg__input"
          aria-label="Alarm sound"
          value={alarmSoundId}
          onChange={(event) => onSelectSound(event.target.value)}
        >
          {BUILT_IN_SOUNDS.map((sound) => (
            <option key={sound.id} value={sound.id}>
              {sound.label}
            </option>
          ))}
          <option value="custom">
            {customAlarm ? `Custom: ${customAlarm.name}` : 'Custom file…'}
          </option>
        </select>
        <button
          type="button"
          className="btn btn--ghost"
          title="Play a sample"
          onClick={() => previewSound(soundUrl)}
        >
          Preview
        </button>
        {alarmSoundId === 'custom' && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={uploading}
            onClick={() => void uploadCustom()}
          >
            {uploading ? 'Importing…' : customAlarm ? 'Change file…' : 'Choose audio file…'}
          </button>
        )}
      </div>
      {uploadError && (
        <p className="miniapp__hint miniapp__error" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  )
}

function AlarmCard({ alarm }: { alarm: AlarmItem }): React.JSX.Element {
  const updateAlarm = useAppStore((state) => state.updateAlarm)
  const removeAlarm = useAppStore((state) => state.removeAlarm)

  const stop = (): void => {
    updateAlarm(alarm.id, {
      ringing: false,
      snoozeUntil: null,
      quietUntil: Date.now() + 60_000
    })
    silenceUnlessRinging()
  }

  const snooze = (): void => {
    const next = addMinutesHHMM(nowHHMM(), 5)
    if (!next) return
    updateAlarm(alarm.id, { ringing: false, snoozeUntil: next })
    silenceUnlessRinging()
  }

  const onToggleEnabled = (enabled: boolean): void => {
    if (!enabled && alarm.ringing) {
      updateAlarm(alarm.id, {
        enabled,
        ringing: false,
        snoozeUntil: null,
        quietUntil: Date.now() + 60_000
      })
      silenceUnlessRinging()
      return
    }
    updateAlarm(alarm.id, { enabled })
  }

  const onDelete = (): void => {
    removeAlarm(alarm.id)
    silenceUnlessRinging()
  }

  return (
    <section className={`miniapp${alarm.ringing ? ' is-ringing' : ''}`} aria-label={alarm.label}>
      <header className="miniapp__head">
        <AlarmIcon size={18} />
        <input
          className="miniapp__name"
          aria-label="Alarm name"
          title="Click to rename"
          placeholder="Alarm name"
          value={alarm.label}
          spellCheck={false}
          onChange={(event) => updateAlarm(alarm.id, { label: event.target.value })}
        />
        <DeleteButton label={alarm.label} onDelete={onDelete} />
      </header>
      <div className="miniapp__clock">{formatTime12h(alarm.time)}</div>
      <div className="miniapp__row">
        <input
          type="time"
          className="dlg__input"
          aria-label={`${alarm.label} time`}
          value={alarm.time ?? ''}
          onChange={(event) => updateAlarm(alarm.id, { time: event.target.value || null })}
        />
      </div>
      <div className="miniapp__row">
        <SoundSelect
          label={`${alarm.label} sound`}
          value={alarm.soundId}
          onChange={(soundId) => updateAlarm(alarm.id, { soundId })}
        />
      </div>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={alarm.enabled}
          onChange={(event) => onToggleEnabled(event.target.checked)}
        />
        Enabled
      </label>
      {alarm.ringing ? (
        <div className="miniapp__row">
          <button type="button" className="btn btn--primary" onClick={stop}>
            Stop
          </button>
          <button type="button" className="btn btn--ghost" onClick={snooze}>
            Snooze 5 min
          </button>
        </div>
      ) : (
        <p className="miniapp__hint">
          {!alarm.enabled || !alarm.time
            ? 'Set a time and enable the alarm.'
            : alarm.snoozeUntil
              ? `Snoozed until ${formatTime12h(alarm.snoozeUntil)}.`
              : `Rings daily at ${formatTime12h(alarm.time)} while the app is open.`}
        </p>
      )}
    </section>
  )
}

function TimerCard({ timer, now }: { timer: TimerItem; now: number }): React.JSX.Element {
  const updateTimer = useAppStore((state) => state.updateTimer)
  const removeTimer = useAppStore((state) => state.removeTimer)
  const [draft, setDraft] = useState(() => formatDurationDraft(timer.totalSec))

  const remaining =
    timer.running && timer.endsAt !== null
      ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
      : timer.leftSec
  const idle = !timer.running && !timer.ringing
  const paused = idle && remaining > 0 && remaining < timer.totalSec

  const start = (): void => {
    const seconds = parseDurationInput(draft)
    if (seconds === null) return
    stopAlarm()
    updateTimer(timer.id, {
      totalSec: seconds,
      leftSec: seconds,
      endsAt: Date.now() + seconds * 1000,
      running: true,
      ringing: false
    })
  }

  const pause = (): void => {
    updateTimer(timer.id, { running: false, leftSec: remaining, endsAt: null })
  }

  const resume = (): void => {
    if (remaining <= 0) return
    updateTimer(timer.id, { running: true, endsAt: Date.now() + remaining * 1000 })
  }

  const reset = (): void => {
    updateTimer(timer.id, {
      running: false,
      ringing: false,
      leftSec: timer.totalSec,
      endsAt: null
    })
    setDraft(formatDurationDraft(timer.totalSec))
    silenceUnlessRinging()
  }

  const onDelete = (): void => {
    removeTimer(timer.id)
    silenceUnlessRinging()
  }

  const progress = timer.totalSec ? Math.min(1, Math.max(0, 1 - remaining / timer.totalSec)) : 0

  return (
    <section className={`miniapp${timer.ringing ? ' is-ringing' : ''}`} aria-label={timer.label}>
      <header className="miniapp__head">
        <TimerIcon size={18} />
        <input
          className="miniapp__name"
          aria-label="Timer name"
          title="Click to rename"
          placeholder="Timer name"
          value={timer.label}
          spellCheck={false}
          onChange={(event) => updateTimer(timer.id, { label: event.target.value })}
        />
        <DeleteButton label={timer.label} onDelete={onDelete} />
      </header>
      <div className="miniapp__clock">{formatElapsed(remaining)}</div>
      <div className="miniapp__bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="miniapp__row">
        <input
          className="dlg__input"
          aria-label={`${timer.label} duration (MM:SS)`}
          value={draft}
          placeholder="MM:SS"
          spellCheck={false}
          disabled={timer.running || paused}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className="miniapp__row">
        <SoundSelect
          label={`${timer.label} sound`}
          value={timer.soundId}
          onChange={(soundId) => updateTimer(timer.id, { soundId })}
        />
      </div>
      <div className="miniapp__row">
        {timer.ringing ? (
          <button type="button" className="btn btn--primary" onClick={reset}>
            Stop
          </button>
        ) : timer.running ? (
          <button type="button" className="btn btn--primary" onClick={pause}>
            Pause
          </button>
        ) : paused ? (
          <button type="button" className="btn btn--primary" onClick={resume}>
            Resume
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={start}>
            Start
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Reset
        </button>
      </div>
      {timer.ringing && <p className="miniapp__hint">Time&apos;s up!</p>}
      {idle && !timer.ringing && (
        <p className="miniapp__hint">
          {paused ? 'Paused — resume or reset.' : 'Set a duration and start.'}
        </p>
      )}
    </section>
  )
}

function StopwatchCard({ sw, now }: { sw: StopwatchItem; now: number }): React.JSX.Element {
  const updateStopwatch = useAppStore((state) => state.updateStopwatch)
  const removeStopwatch = useAppStore((state) => state.removeStopwatch)

  const running = sw.startStamp !== null
  const elapsedMs = sw.accMs + (sw.startStamp !== null ? Math.max(0, now - sw.startStamp) : 0)

  const start = (): void => {
    updateStopwatch(sw.id, { startStamp: Date.now() })
  }

  const stop = (): void => {
    if (sw.startStamp === null) return
    updateStopwatch(sw.id, {
      accMs: sw.accMs + Math.max(0, Date.now() - sw.startStamp),
      startStamp: null
    })
  }

  const reset = (): void => {
    updateStopwatch(sw.id, { accMs: 0, startStamp: null })
  }

  return (
    <section className="miniapp" aria-label={sw.label}>
      <header className="miniapp__head">
        <StopwatchIcon size={18} />
        <input
          className="miniapp__name"
          aria-label="Stopwatch name"
          title="Click to rename"
          placeholder="Stopwatch name"
          value={sw.label}
          spellCheck={false}
          onChange={(event) => updateStopwatch(sw.id, { label: event.target.value })}
        />
        <DeleteButton label={sw.label} onDelete={() => removeStopwatch(sw.id)} />
      </header>
      <div className="miniapp__clock">{formatElapsed(elapsedMs / 1000)}</div>
      <div className="miniapp__row">
        {running ? (
          <button type="button" className="btn btn--primary" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={start}>
            Start
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Reset
        </button>
      </div>
      <p className="miniapp__hint">Hundredths precision while running.</p>
    </section>
  )
}

const POMODORO_LABEL: Record<Exclude<PomodoroPhase, 'idle'>, string> = {
  focus: 'Focus',
  break: 'Short break',
  longBreak: 'Long break'
}

function pomodoroPhaseMinutes(pomo: PomodoroState, phase: PomodoroPhase): number {
  if (phase === 'break') return pomo.breakMin
  if (phase === 'longBreak') return pomo.longBreakMin
  return pomo.focusMin
}

/** Next phase after the current one ends (or is skipped). */
function advancePomodoro(pomo: PomodoroState, startRunning: boolean): Partial<PomodoroState> {
  const now = Date.now()
  let phase: PomodoroPhase = 'focus'
  let completedFocus = pomo.completedFocus
  if (pomo.phase === 'focus') {
    phase =
      completedFocus > 0 && completedFocus % pomo.roundsBeforeLong === 0 ? 'longBreak' : 'break'
  } else if (pomo.phase === 'break') {
    phase = 'focus'
  } else if (pomo.phase === 'longBreak') {
    phase = 'focus'
    completedFocus = 0
  }
  const minutes = pomodoroPhaseMinutes({ ...pomo, phase }, phase)
  return {
    phase,
    completedFocus,
    ringing: false,
    running: startRunning,
    endsAt: startRunning ? now + minutes * 60 * 1000 : null,
    leftSec: minutes * 60
  }
}

function PomodoroCard({ now }: { now: number }): React.JSX.Element {
  const pomo = useAppStore((state) => state.pomodoro)
  const updatePomodoro = useAppStore((state) => state.updatePomodoro)

  const remaining =
    pomo.running && pomo.endsAt !== null
      ? Math.max(0, Math.ceil((pomo.endsAt - now) / 1000))
      : pomo.leftSec
  const phaseLenSec = Math.max(1, pomodoroPhaseMinutes(pomo, pomo.phase) * 60)
  const progress = Math.min(1, Math.max(0, 1 - remaining / phaseLenSec))
  const previewing = !pomo.running && !pomo.ringing && pomo.phase !== 'idle'

  const start = (): void => {
    stopAlarm()
    if (pomo.phase === 'idle') {
      updatePomodoro({
        phase: 'focus',
        ringing: false,
        running: true,
        endsAt: Date.now() + pomo.focusMin * 60 * 1000,
        leftSec: pomo.focusMin * 60
      })
      return
    }
    updatePomodoro({
      running: true,
      ringing: false,
      endsAt: Date.now() + Math.max(0, remaining) * 1000
    })
  }

  const pause = (): void => {
    updatePomodoro({ running: false, leftSec: remaining, endsAt: null })
  }

  const reset = (): void => {
    updatePomodoro({
      phase: 'idle',
      running: false,
      ringing: false,
      endsAt: null,
      leftSec: pomo.focusMin * 60,
      completedFocus: 0
    })
    silenceUnlessRinging()
  }

  const skip = (): void => {
    updatePomodoro(advancePomodoro(pomo, pomo.running))
    silenceUnlessRinging()
  }

  const stopRing = (): void => {
    // Dismissing the ring moves on (running when auto-advance is on).
    updatePomodoro(advancePomodoro(pomo, pomo.autoAdvance))
    silenceUnlessRinging()
  }

  const setMinutes = (key: 'focusMin' | 'breakMin' | 'longBreakMin', value: string): void => {
    const minutes = Math.min(180, Math.max(1, Math.floor(Number(value) || 0)))
    if (!minutes) return
    const patch: Partial<PomodoroState> = {}
    if (key === 'focusMin') patch.focusMin = minutes
    else if (key === 'breakMin') patch.breakMin = minutes
    else patch.longBreakMin = minutes
    // Retune the live preview when editing the phase on screen (idle shows focus).
    const phaseKey =
      pomo.phase === 'break' ? 'breakMin' : pomo.phase === 'longBreak' ? 'longBreakMin' : 'focusMin'
    if (!pomo.running && !pomo.ringing && key === phaseKey) {
      patch.leftSec = minutes * 60
    }
    updatePomodoro(patch)
  }

  const dots = Array.from({ length: pomo.roundsBeforeLong }, (_, i) => i)

  return (
    <section className={`miniapp${pomo.ringing ? ' is-ringing' : ''}`} aria-label="Pomodoro">
      <header className="miniapp__head">
        <TimerIcon size={18} />
        <h3>Pomodoro</h3>
      </header>
      <div className="miniapp__row">
        <span className="pomo__phase">
          {pomo.phase === 'idle' ? 'Ready' : POMODORO_LABEL[pomo.phase]}
        </span>
        <span className="pomo__dots" aria-label={`${pomo.completedFocus} sessions done`}>
          {dots.map((i) => (
            <span key={i} className={`pomo__dot${i < pomo.completedFocus ? ' is-done' : ''}`} />
          ))}
        </span>
      </div>
      <div className="miniapp__clock">{formatElapsed(remaining)}</div>
      <div className="miniapp__bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="miniapp__row">
        {pomo.ringing ? (
          <button type="button" className="btn btn--primary" onClick={stopRing}>
            Stop
          </button>
        ) : pomo.running ? (
          <button type="button" className="btn btn--primary" onClick={pause}>
            Pause
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={start}>
            {pomo.phase === 'idle' ? 'Start focus' : previewing ? 'Resume' : 'Start'}
          </button>
        )}
        {!pomo.ringing && pomo.phase !== 'idle' && (
          <button type="button" className="btn btn--ghost" onClick={skip}>
            Skip
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Reset
        </button>
      </div>
      {pomo.ringing && (
        <p className="miniapp__hint">
          {pomo.phase === 'focus' ? 'Focus done — break time!' : 'Break over — back to focus!'}
        </p>
      )}
      <div className="pomo__settings">
        <label className="pomo__field">
          Focus
          <input
            type="number"
            className="dlg__input"
            min={1}
            max={180}
            value={pomo.focusMin}
            aria-label="Focus minutes"
            onChange={(event) => setMinutes('focusMin', event.target.value)}
          />
        </label>
        <label className="pomo__field">
          Break
          <input
            type="number"
            className="dlg__input"
            min={1}
            max={60}
            value={pomo.breakMin}
            aria-label="Break minutes"
            onChange={(event) => setMinutes('breakMin', event.target.value)}
          />
        </label>
        <label className="pomo__field">
          Long
          <input
            type="number"
            className="dlg__input"
            min={1}
            max={90}
            value={pomo.longBreakMin}
            aria-label="Long break minutes"
            onChange={(event) => setMinutes('longBreakMin', event.target.value)}
          />
        </label>
        <label className="pomo__field">
          Every
          <input
            type="number"
            className="dlg__input"
            min={2}
            max={12}
            value={pomo.roundsBeforeLong}
            aria-label="Sessions before long break"
            onChange={(event) =>
              updatePomodoro({
                roundsBeforeLong: Math.min(
                  12,
                  Math.max(2, Math.floor(Number(event.target.value) || 0) || 4)
                )
              })
            }
          />
        </label>
      </div>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={pomo.autoAdvance}
          onChange={(event) => updatePomodoro({ autoAdvance: event.target.checked })}
        />
        Auto-start next phase
      </label>
      <div className="miniapp__row">
        <SoundSelect
          label="Pomodoro sound"
          value={pomo.soundId}
          onChange={(soundId) => updatePomodoro({ soundId })}
        />
      </div>
    </section>
  )
}

function ClockSection({
  icon,
  title,
  count,
  onAdd,
  addLabel,
  children
}: {
  icon: React.JSX.Element
  title: string
  count: number
  onAdd: () => void
  addLabel: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="clock-section" aria-label={title}>
      <div className="clock-section__head">
        {icon}
        <h2 className="clock-section__title">
          {title} <span className="clock-section__count">{count}</span>
        </h2>
        <button type="button" className="btn btn--ghost" onClick={onAdd} title={addLabel}>
          <PlusIcon size={14} /> Add
        </button>
      </div>
      <div className="misc__grid">{children}</div>
    </section>
  )
}

function Misc(): React.JSX.Element {
  const alarms = useAppStore((state) => state.alarms)
  const timers = useAppStore((state) => state.timers)
  const stopwatches = useAppStore((state) => state.stopwatches)
  const addAlarm = useAppStore((state) => state.addAlarm)
  const addTimer = useAppStore((state) => state.addTimer)
  const addStopwatch = useAppStore((state) => state.addStopwatch)
  const now = useNowMs(250)

  return (
    <main className="misc">
      <div className="misc__inner">
        <header className="misc__header">
          <div>
            <h1 className="misc__title">Misc</h1>
            <p className="misc__subtitle">Small utilities that live beside your notes.</p>
          </div>
        </header>
        <SoundSettings />
        <ClockSection
          icon={<AlarmIcon size={17} />}
          title="Alarms"
          count={alarms.length}
          onAdd={() => addAlarm()}
          addLabel="Add alarm"
        >
          {alarms.map((alarm) => (
            <AlarmCard key={alarm.id} alarm={alarm} />
          ))}
          {alarms.length === 0 && (
            <p className="miniapp__hint">No alarms yet — add one to get started.</p>
          )}
        </ClockSection>
        <ClockSection
          icon={<TimerIcon size={17} />}
          title="Timers"
          count={timers.length}
          onAdd={() => addTimer()}
          addLabel="Add timer"
        >
          {timers.map((timer) => (
            <TimerCard key={timer.id} timer={timer} now={now} />
          ))}
          {timers.length === 0 && (
            <p className="miniapp__hint">No timers yet — add one to get started.</p>
          )}
        </ClockSection>
        <section className="clock-section" aria-label="Pomodoro">
          <div className="clock-section__head">
            <TimerIcon size={17} />
            <h2 className="clock-section__title">Pomodoro</h2>
          </div>
          <div className="misc__grid">
            <PomodoroCard now={now} />
          </div>
        </section>
        <ClockSection
          icon={<StopwatchIcon size={17} />}
          title="Stopwatches"
          count={stopwatches.length}
          onAdd={() => addStopwatch()}
          addLabel="Add stopwatch"
        >
          {stopwatches.map((sw) => (
            <StopwatchCard key={sw.id} sw={sw} now={now} />
          ))}
          {stopwatches.length === 0 && (
            <p className="miniapp__hint">No stopwatches yet — add one to get started.</p>
          )}
        </ClockSection>
      </div>
    </main>
  )
}

export default Misc
