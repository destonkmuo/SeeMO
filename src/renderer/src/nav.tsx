/* eslint-disable react-refresh/only-export-components */
import {
  ActivityIcon,
  AgentIcon,
  CalendarIcon,
  GraphIcon,
  HomeIcon,
  ListTodoIcon,
  MoreIcon,
  SettingsIcon
} from './components/icons'
import type { NavKey } from './store/appStore'

export interface NavItem {
  key: NavKey
  label: string
  icon: (props: { size?: number }) => React.JSX.Element
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'graph', label: 'Graph', icon: GraphIcon },
  { key: 'todo', label: 'Todo', icon: ListTodoIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'agent', label: 'AI Agent', icon: AgentIcon },
  { key: 'activity', label: 'AI Activity', icon: ActivityIcon },
  { key: 'misc', label: 'Misc', icon: MoreIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon }
]

export const NAV_BY_KEY = Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item])) as Record<
  NavKey,
  NavItem
>

export const NAV_LABELS = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.key, item.label])
) as Record<NavKey, string>
