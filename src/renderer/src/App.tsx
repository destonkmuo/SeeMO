import Navbar from './components/Navbar'
import Agent from './pages/Agent'
import Home from './pages/Home'
import { useAppStore } from './store/appStore'

function App(): React.JSX.Element {
  const active = useAppStore((state) => state.active)

  return (
    <div className="app">
      <div className="app__content">{active === 'agent' ? <Agent /> : <Home />}</div>
      <Navbar />
    </div>
  )
}

export default App
