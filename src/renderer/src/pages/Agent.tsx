import JarvisCore from '../components/JarvisCore'
import { useAppStore } from '../store/appStore'

function Agent(): React.JSX.Element {
  const speaking = useAppStore((state) => state.speaking)
  const toggleSpeaking = useAppStore((state) => state.toggleSpeaking)

  return (
    <main className="agent">
      <div className="agent__core">
        <JarvisCore />
      </div>
      <div className="agent__controls">
        <button type="button" className="agent__toggle" onClick={toggleSpeaking}>
          {speaking ? 'Stop speaking' : 'Simulate speaking'}
        </button>
        <span className="agent__status">
          Status: <strong>{speaking ? 'Speaking' : 'Idle'}</strong>
        </span>
      </div>
    </main>
  )
}

export default Agent
