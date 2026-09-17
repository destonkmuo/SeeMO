import { FileTextIcon, PlusIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'

function Home(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const createNote = useAppStore((state) => state.createNote)
  const openNote = useAppStore((state) => state.openNote)

  const recent = notes
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)

  return (
    <main className="home">
      <div className="home__inner">
        <header className="home__header">
          <div>
            <h1 className="home__title">SeeMO</h1>
            <p className="home__subtitle">Your notes, organized and always in motion.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => createNote()}>
            <PlusIcon size={15} />
            New note
          </button>
        </header>

        <section className="home__section">
          <h2 className="home__section-title">Recent</h2>
          {recent.length === 0 ? (
            <button type="button" className="home__empty" onClick={() => createNote()}>
              <FileTextIcon size={20} />
              <span>No notes yet. Create your first one.</span>
            </button>
          ) : (
            <div className="home__grid">
              {recent.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="home__card"
                  onClick={() => openNote(note.id)}
                >
                  <span className="home__card-title">{note.title.trim() || 'Untitled'}</span>
                  <span className="home__card-preview">
                    {note.content
                      .trim()
                      .replace(/[#*`>_~-]/g, '')
                      .slice(0, 90) || 'Empty note'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default Home
