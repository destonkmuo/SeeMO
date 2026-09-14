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

interface NavbarProps {
  active: NavKey
  onChange: (key: NavKey) => void
}

function Navbar({ active, onChange }: NavbarProps): React.JSX.Element {
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
            onClick={() => onChange(item.key)}
          >
            <Icon size={22} />
          </button>
        )
      })}
    </nav>
  )
}

export default Navbar
