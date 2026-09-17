import type { NavKey } from '../store/appStore'

const SECTIONS: Record<
  Exclude<NavKey, 'home' | 'agent' | 'settings'>,
  { title: string; body: string }
> = {
  todo: { title: 'Todo', body: 'Tasks will live here.' },
  calendar: { title: 'Calendar', body: 'Your schedule will live here.' },
  activity: { title: 'AI Activity', body: 'A log of what the agent has been doing.' },
  misc: { title: 'Misc', body: 'Everything else.' }
}

function Section({
  section
}: {
  section: Exclude<NavKey, 'home' | 'agent' | 'settings'>
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
