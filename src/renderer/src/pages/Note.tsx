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
            onClick={() => {
              const label = note.title.trim() || 'Untitled'
              if (window.confirm(`Delete "${label}"? This cannot be undone.`)) {
                deleteNote(note.id)
              }
            }}
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
            onKeyDown={(event) => {
              // Keep Tab inside the note: jump into the body editor instead of
              // tabbing back to the sidebar search box. Ctrl/Cmd+Tab stays
              // reserved for the global tab switcher.
              if (
                event.key === 'Tab' &&
                !event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              ) {
                event.preventDefault()
                const blocks = document.querySelector('.blocks')
                const editor = blocks?.querySelector<HTMLTextAreaElement>('textarea')
                if (editor) {
                  editor.focus()
                } else {
                  ;(blocks?.querySelector<HTMLElement>('.block') as HTMLElement | null)?.click()
                }
              }
            }}
          />

          <BlockEditor
            value={note.content}
            onChange={(content) => updateNote(note.id, { content })}
            placeholder="Write anything…  # heading · - list · **bold** · $math$ · ```js runs · Shift+Enter new block"
          />
        </div>
      </div>

      <footer className="note__hints" aria-label="Editor shortcuts">
        <span>
          <kbd>Shift</kbd>+<kbd>Enter</kbd> new block
        </span>
        <span>
          <kbd>Enter</kbd> newline
        </span>
        <span>
          <kbd>Tab</kbd> indent
        </span>
        <span>
          <kbd>$…$</kbd> math
        </span>
        <span>
          <kbd>```js</kbd> + Run
        </span>
        <span>
          <kbd>[[link]]</kbd> pages
        </span>
      </footer>
    </main>
  )
}

export default Note
