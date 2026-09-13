import Navbar from './components/Navbar'
import Home from './pages/Home'

function App(): React.JSX.Element {
  return (
    <div className="app">
      <Home />
      <Navbar />
    </div>
  )
}

export default App
