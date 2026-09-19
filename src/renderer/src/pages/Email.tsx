import { MailIcon } from '../components/icons'

/** Placeholder inbox — sync and compose land here later. */
function Email(): React.JSX.Element {
  return (
    <main className="home">
      <div className="home__inner">
        <header className="home__header">
          <div>
            <h1 className="home__title">Email</h1>
            <p className="home__subtitle">Nothing here yet — your inbox will live here.</p>
          </div>
          <MailIcon size={28} />
        </header>
      </div>
    </main>
  )
}

export default Email
