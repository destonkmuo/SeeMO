import { useEffect, useMemo } from 'react'
import BlockEditor from '../components/BlockEditor'
import { FileTextIcon, TrashIcon } from '../components/icons'
import { useAppStore } from '../store/appStore'

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function Note({ noteId }: { noteId: string }): React.JSX.Element {
  const note = useAppStore((state) => state.notes.find((n) => n.id === noteId) ?? null)
  const updateNote = useAppStore((state) => state.updateNote)
  const deleteNote = useAppStore((state) => state.deleteNote)

  // Autosave title/body to the vault file, debounced past typing bursts.
  const saveId = note?.id
  const saveTitle = note?.title
  const saveContent = note?.content
  useEffect(() => {
    if (!saveId) return
    const timer = setTimeout(() => {
      void useAppStore.getState().saveNoteToVault(saveId)
    }, 600)
    return () => clearTimeout(timer)
  }, [saveId, saveTitle, saveContent])

  const edited = useMemo(() => (note ? relativeTime(note.updatedAt) : ''), [note])

  if (!note) {
    return (
      <main className="note note--empty">
        <FileTextIcon size={28} />
        <p>Select a note from the sidebar, or create a new one.</p>
      </main>
    )
  }

  return (
    <main className="note">
      <header className="note__bar">
        <span className="note__meta">
          Edited {edited}
          {note.fileName ? ` · ${note.fileName}` : ''}
        </span>
        <div className="note__actions">
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            title="Delete note"
            aria-label="Delete note"
            onClick={() => deleteNote(note.id)}
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </header>

      <div className="note__scroll">
        <div className="note__doc">
          <input
            className="note__title"
            value={note.title}
            placeholder="Untitled"
            spellCheck={false}
            onChange={(event) => updateNote(note.id, { title: event.target.value })}
          />

          <BlockEditor
            value={note.content}
            onChange={(content) => updateNote(note.id, { content })}
            placeholder="Write in markdown…  # heading, - list, **bold**"
          />
        </div>
      </div>
    </main>
  )
}

export default Note
