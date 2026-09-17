import type { NavKey } from '../store/appStore'

const SECTIONS: Record<
  Exclude<NavKey, 'home' | 'graph' | 'agent' | 'settings' | 'todo' | 'calendar' | 'misc'>,
  { title: string; body: string }
> = {
  activity: { title: 'SeeMO Activity', body: 'A log of what SeeMO has been doing.' }
}

function Section({
  section
}: {
  section: Exclude<NavKey, 'home' | 'graph' | 'agent' | 'settings' | 'todo' | 'calendar' | 'misc'>
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
