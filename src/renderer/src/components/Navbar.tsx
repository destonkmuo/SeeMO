import { type NavKey, useAppStore } from '../store/appStore'
import { ActivityIcon, AgentIcon, CalendarIcon, ListTodoIcon, MoreIcon } from './icons'

interface NavItem {
  key: NavKey
  label: string
  icon: (props: { size?: number }) => React.JSX.Element
}

const navItems: NavItem[] = [
  { key: 'todo', label: 'Todo', icon: ListTodoIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'agent', label: 'AI Agent', icon: AgentIcon },
  { key: 'activity', label: 'AI Activity', icon: ActivityIcon },
  { key: 'misc', label: 'Misc', icon: MoreIcon }
]

function Navbar(): React.JSX.Element {
  const active = useAppStore((state) => state.active)
  const setActive = useAppStore((state) => state.setActive)

  return (
    <nav className="navbar" aria-label="Primary navigation">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.key}
            type="button"
            className={`navbar__item${active === item.key ? ' is-active' : ''}`}
            aria-label={item.label}
            title={item.label}
            onClick={() => setActive(item.key)}
          >
            <Icon size={22} />
          </button>
        )
      })}
    </nav>
  )
}

export default Navbar
