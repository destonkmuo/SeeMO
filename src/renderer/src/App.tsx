import { useState } from 'react'
import Navbar, { type NavKey } from './components/Navbar'
import Agent from './pages/Agent'
import Home from './pages/Home'

function App(): React.JSX.Element {
  const [active, setActive] = useState<NavKey>('agent')

  return (
    <div className="app">
      <div className="app__content">
        {active === 'agent' ? <Agent /> : <Home />}
      </div>
      <Navbar active={active} onChange={setActive} />
    </div>
  )
}

export default App
