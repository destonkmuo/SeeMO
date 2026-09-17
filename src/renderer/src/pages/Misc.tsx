import { useEffect, useRef, useState } from 'react'
import { BUILT_IN_SOUNDS, previewSound, resolveSoundUrl, startAlarmLoop, stopAlarm } from '../alarm'
import { AlarmIcon, StopwatchIcon, TimerIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'
import { addMinutesHHMM, formatElapsed, isAlarmDue, nowHHMM, parseDurationInput } from '../time'

function AlarmApp(): React.JSX.Element {
  const alarmTime = useAppStore((state) => state.alarmTime)
  const alarmEnabled = useAppStore((state) => state.alarmEnabled)
  const setAlarmTime = useAppStore((state) => state.setAlarmTime)
  const setAlarmEnabled = useAppStore((state) => state.setAlarmEnabled)
  const alarmSoundId = useAppStore((state) => state.alarmSoundId)
  const setAlarmSoundId = useAppStore((state) => state.setAlarmSoundId)
  const customAlarm = useAppStore((state) => state.customAlarm)
  const setCustomAlarm = useAppStore((state) => state.setCustomAlarm)

  const [ringing, setRinging] = useState(false)
  const [snoozeUntil, setSnoozeUntil] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const quietUntil = useRef(0)

  const soundUrl = resolveSoundUrl(alarmSoundId, customAlarm?.url ?? null)

  useEffect(() => {
    if (!alarmEnabled) return
    const timer = setInterval(() => {
      if (Date.now() < quietUntil.current) return
      if (snoozeUntil && snoozeUntil !== nowHHMM()) setSnoozeUntil(null)
      const target = snoozeUntil ?? alarmTime
      if (target && isAlarmDue(target)) {
        startAlarmLoop(
          resolveSoundUrl(
            useAppStore.getState().alarmSoundId,
            useAppStore.getState().customAlarm?.url ?? null
          )
        )
        setRinging(true)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [alarmEnabled, alarmTime, snoozeUntil])

  useEffect(() => stopAlarm, [])

  const stop = (): void => {
    stopAlarm()
    setRinging(false)
    setSnoozeUntil(null)
    quietUntil.current = Date.now() + 60_000
  }

  const snooze = (): void => {
    const next = addMinutesHHMM(nowHHMM(), 5)
    stopAlarm()
    setRinging(false)
    setSnoozeUntil(next)
    quietUntil.current = Date.now() + 60_000
  }

  const uploadCustom = async (): Promise<void> => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await window.api.importAlarmSound()
      if (!result) return // user canceled the picker
      setCustomAlarm({ name: result.name, url: result.url })
      setAlarmSoundId('custom')
      if (ringing) startAlarmLoop(result.url)
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
    if (ringing) startAlarmLoop(resolveSoundUrl(id, customAlarm?.url ?? null))
  }

  return (
    <section className={`miniapp${ringing ? ' is-ringing' : ''}`} aria-label="Alarm">
      <header className="miniapp__head">
        <AlarmIcon size={18} />
        <h3>Alarm</h3>
      </header>
      <div className="miniapp__clock">{alarmTime ?? '--:--'}</div>
      <div className="miniapp__row">
        <input
          type="time"
          className="dlg__input"
          aria-label="Alarm time"
          value={alarmTime ?? ''}
          onChange={(event) => setAlarmTime(event.target.value || null)}
        />
      </div>
      <div className="miniapp__row">
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
      </div>
      {alarmSoundId === 'custom' && (
        <div className="miniapp__row">
          {customAlarm ? (
            <>
              <span className="miniapp__hint">Using {customAlarm.name}.</span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={uploading}
                onClick={() => void uploadCustom()}
              >
                Change file…
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={uploading}
              onClick={() => void uploadCustom()}
            >
              {uploading ? 'Importing…' : 'Choose audio file…'}
            </button>
          )}
        </div>
      )}
      {uploadError && (
        <p className="miniapp__hint miniapp__error" role="alert">
          {uploadError}
        </p>
      )}
      <label className="settings__check">
        <input
          type="checkbox"
          checked={alarmEnabled}
          onChange={(event) => {
            if (!event.target.checked) stop()
            setAlarmEnabled(event.target.checked)
          }}
        />
        Enabled
      </label>
      {ringing ? (
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
          {!alarmEnabled || !alarmTime
            ? 'Set a time and enable the alarm.'
            : snoozeUntil
              ? `Snoozed until ${snoozeUntil}.`
              : `Rings daily at ${alarmTime} while the app is open.`}
        </p>
      )}
    </section>
  )
}

function TimerApp(): React.JSX.Element {
  const alarmSoundId = useAppStore((state) => state.alarmSoundId)
  const customAlarm = useAppStore((state) => state.customAlarm)
  const [input, setInput] = useState('5:00')
  const [totalSec, setTotalSec] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const [running, setRunning] = useState(false)
  const [ringing, setRinging] = useState(false)
  const endsAt = useRef(0)
  const soundUrl = resolveSoundUrl(alarmSoundId, customAlarm?.url ?? null)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      const remain = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000))
      setLeft(remain)
      if (remain <= 0) {
        setRunning(false)
        startAlarmLoop(soundUrl)
        setRinging(true)
      }
    }, 200)
    return () => clearInterval(timer)
  }, [running, soundUrl])

  useEffect(() => stopAlarm, [])

  const start = (): void => {
    const seconds = parseDurationInput(input)
    if (seconds === null) return
    stopAlarm()
    setRinging(false)
    setTotalSec(seconds)
    setLeft(seconds)
    endsAt.current = Date.now() + seconds * 1000
    setRunning(true)
  }

  const pauseResume = (): void => {
    if (running) {
      setRunning(false)
    } else if (left > 0) {
      endsAt.current = Date.now() + left * 1000
      setRunning(true)
    }
  }

  const reset = (): void => {
    setRunning(false)
    stopAlarm()
    setRinging(false)
    setLeft(totalSec ?? 0)
  }

  const progress = totalSec ? Math.min(1, Math.max(0, 1 - left / totalSec)) : 0

  const paused = !running && !ringing && left > 0

  return (
    <section className={`miniapp${ringing ? ' is-ringing' : ''}`} aria-label="Countdown timer">
      <header className="miniapp__head">
        <TimerIcon size={18} />
        <h3>Timer</h3>
      </header>
      <div className="miniapp__clock">{formatElapsed(left)}</div>
      <div className="miniapp__bar">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="miniapp__row">
        <input
          className="dlg__input"
          aria-label="Duration (MM:SS)"
          value={input}
          placeholder="MM:SS"
          spellCheck={false}
          disabled={running || paused}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
      <div className="miniapp__row">
        {ringing ? (
          <button type="button" className="btn btn--primary" onClick={reset}>
            Stop
          </button>
        ) : running ? (
          <button type="button" className="btn btn--primary" onClick={pauseResume}>
            Pause
          </button>
        ) : paused ? (
          <button type="button" className="btn btn--primary" onClick={pauseResume}>
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
      {ringing && <p className="miniapp__hint">Time&apos;s up!</p>}
    </section>
  )
}

function StopwatchApp(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const acc = useRef(0)
  const startStamp = useRef(0)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      setElapsed((acc.current + Date.now() - startStamp.current) / 1000)
    }, 100)
    return () => clearInterval(timer)
  }, [running])

  const start = (): void => {
    startStamp.current = Date.now()
    setRunning(true)
  }

  const stop = (): void => {
    acc.current += Date.now() - startStamp.current
    setElapsed(acc.current / 1000)
    setRunning(false)
  }

  const reset = (): void => {
    acc.current = 0
    setElapsed(0)
    setRunning(false)
  }

  return (
    <section className="miniapp" aria-label="Stopwatch">
      <header className="miniapp__head">
        <StopwatchIcon size={18} />
        <h3>Stopwatch</h3>
      </header>
      <div className="miniapp__clock">{formatElapsed(elapsed)}</div>
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

function Misc(): React.JSX.Element {
  return (
    <main className="misc">
      <div className="misc__inner">
        <header className="misc__header">
          <div>
            <h1 className="misc__title">Misc</h1>
            <p className="misc__subtitle">Small utilities that live beside your notes.</p>
          </div>
        </header>
        <div className="misc__grid">
          <AlarmApp />
          <TimerApp />
          <StopwatchApp />
          <section className="miniapp miniapp--soon" aria-label="Coming soon">
            <div className="miniapp__soon">More soon</div>
            <p className="miniapp__hint">New mini-apps will appear here.</p>
          </section>
        </div>
      </div>
    </main>
  )
}

export default Misc
