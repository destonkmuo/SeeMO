import { useState } from 'react'
import {
  ActivityIcon,
  AgentIcon,
  CalendarIcon,
  ListTodoIcon,
  MoreIcon
} from './icons'

export type NavKey = 'todo' | 'calendar' | 'agent' | 'activity' | 'misc'

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
  const [active, setActive] = useState<NavKey>('todo')

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
