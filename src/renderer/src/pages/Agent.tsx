import JarvisCore from '../components/JarvisCore'
import { type CoreState, useAppStore } from '../store/appStore'

const STATES: { key: CoreState; label: string; hint: string }[] = [
  { key: 'sleep', label: 'Sleep', hint: 'Dormant — not working, not spoken to' },
  { key: 'idle', label: 'Idle', hint: 'Listening — being spoken to' },
  { key: 'working', label: 'Working', hint: 'On an objective' },
  { key: 'speaking', label: 'Speaking', hint: 'Talking back' }
]

function Agent(): React.JSX.Element {
  const coreState = useAppStore((state) => state.coreState)
  const setCoreState = useAppStore((state) => state.setCoreState)
  const activeHint = STATES.find((s) => s.key === coreState)?.hint ?? ''

  return (
    <main className="agent">
      <div className="agent__core">
        <JarvisCore />
      </div>
      <div className="agent__controls">
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            className="agent__toggle"
            disabled={s.key === coreState}
            title={s.hint}
            onClick={() => setCoreState(s.key)}
          >
            {s.label}
          </button>
        ))}
        {coreState === 'working' ? (
          <span className="agent__thinking">core thinking</span>
        ) : (
          <span className="agent__status">
            Status: <strong>{coreState}</strong> — {activeHint}
          </span>
        )}
      </div>
    </main>
  )
}

export default Agent
