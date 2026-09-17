import type { NavKey } from '../store/appStore'

const SECTIONS: Record<
  Exclude<NavKey, 'home' | 'graph' | 'agent' | 'settings' | 'todo' | 'calendar'>,
  { title: string; body: string }
> = {
  activity: { title: 'AI Activity', body: 'A log of what the agent has been doing.' },
  misc: { title: 'Misc', body: 'Everything else.' }
}

function Section({
  section
}: {
  section: Exclude<NavKey, 'home' | 'graph' | 'agent' | 'settings' | 'todo' | 'calendar'>
}): React.JSX.Element {
  const { title, body } = SECTIONS[section]
  return (
    <main className="section">
      <div className="section__inner">
        <h1 className="section__title">{title}</h1>
        <p className="section__body">{body}</p>
      </div>
    </main>
  )
}

export default Section
