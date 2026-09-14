import { useState } from 'react'
import JarvisCore from '../components/JarvisCore'

function Agent(): React.JSX.Element {
  const [speaking, setSpeaking] = useState(false)

  return (
    <main className="agent">
      <div className="agent__core">
        <JarvisCore speaking={speaking} />
      </div>
      <div className="agent__controls">
        <button
          type="button"
          className="agent__toggle"
          onClick={() => setSpeaking((prev) => !prev)}
        >
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
