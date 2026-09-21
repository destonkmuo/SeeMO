import { useEffect, useMemo, useRef, useState } from 'react'
import BlockEditor from '../components/BlockEditor'
import FindBar from '../components/FindBar'
import { BLOCK_START, joinBlocks, splitBlocks } from '../markdown'
import {
  contentImageSrcs,
  importDroppedPicture,
  type ImageControls,
  type ImageSide
} from '../images'

import { FileTextIcon, ImageIcon, TrashIcon } from '../components/icons'
import { useAppStore, type ImageLayout } from '../store/appStore'

/** Stable empty layout so memo deps don't churn. */
const NO_LAYOUT: Record<string, ImageLayout> = {}

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
  const imageLayout = useAppStore((state) => state.imageLayout)

  const [dropActive, setDropActive] = useState(false)
  const [dropStatus, setDropStatus] = useState<{ msg: string; error: boolean } | null>(null)
  const dropStatusTimer = useRef<number | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const noteRef = useRef<HTMLElement>(null)

  // Ctrl/Cmd+F opens find-in-note. preventDefault stops the (absent) native
  // find so the shortcut never feels dead.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new note starts with a closed find bar.
  useEffect(() => {
    setFindOpen(false)
  }, [noteId])

  // Drop results surface in the UI (success and failure alike) so a silent
  // drop is impossible: if nothing lands, the banner says why.
  const flashDropStatus = (msg: string, error: boolean): void => {
    setDropStatus({ msg, error })
    if (dropStatusTimer.current !== null) window.clearTimeout(dropStatusTimer.current)
    dropStatusTimer.current = window.setTimeout(() => setDropStatus(null), 5000)
  }

  useEffect(
    () => () => {
      if (dropStatusTimer.current !== null) window.clearTimeout(dropStatusTimer.current)
    },
    []
  )

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

  const layout = imageLayout[noteId] ?? NO_LAYOUT
  const srcsInContent = useMemo(() => contentImageSrcs(note?.content ?? ''), [note?.content])

  // Docked pictures: side + width by raw source. Entries whose source left
  // the markdown are ignored until it returns.
  const docked = useMemo(() => {
    const sides: Record<string, ImageSide> = {}
    const widths: Record<string, number> = {}
    for (const [src, entry] of Object.entries(layout)) {
      if (!srcsInContent.has(src)) continue
      if (entry.side === 'left' || entry.side === 'right' || entry.side === 'center') {
        sides[src] = entry.side
      }
      if (typeof entry.w === 'number') widths[src] = entry.w
    }
    return { sides, widths }
  }, [layout, srcsInContent])

  const toggleFloat = (src: string, side: ImageSide = 'right'): void => {
    const state = useAppStore.getState()
    if (state.imageLayout[noteId]?.[src]?.side) state.clearImageFloat(noteId, src)
    else state.setImageSide(noteId, src, side)
  }
  const commitWidth = (src: string, w: number | null): void => {
    useAppStore.getState().setImageSize(noteId, src, w)
  }
  const commitMove = (
    src: string,
    target: { blockIndex: number; above: boolean; side: ImageSide } | null
  ): void => {
    if (!target) return
    const state = useAppStore.getState()
    const current = state.notes.find((n) => n.id === noteId)
    if (!current || current.deletedAt) return
    const blocks = splitBlocks(current.content)
    // Locate the dragged line (first occurrence wins; duplicate sources
    // share one layout entry anyway).
    let from = -1
    let lineAt = -1
    for (let i = 0; i < blocks.length; i++) {
      const at = blocks[i].split('\n').findIndex((line) => line.includes(`](${src})`))
      if (at >= 0) {
        from = i
        lineAt = at
        break
      }
    }
    if (from < 0) return
    const sourceLines = blocks[from].split('\n')
    const [imgLine] = sourceLines.splice(lineAt, 1)
    if (sourceLines.some((line) => line.trim())) blocks[from] = sourceLines.join('\n')
    else blocks.splice(from, 1)
    if (blocks.length === 0) {
      state.updateNote(noteId, { content: imgLine })
      state.setImageSide(noteId, src, target.side)
      return
    }
    let to = target.blockIndex
    if (from < to) to -= 1
    to = Math.max(0, Math.min(to, blocks.length - 1))
    // Merge into plain paragraphs; anything structured (lists, quotes, code)
    // gets the picture as its own adjacent block instead.
    const dest = blocks[to].split('\n')[0] ?? ''
    if (BLOCK_START.test(dest)) {
      blocks.splice(target.above ? to : to + 1, 0, imgLine)
    } else {
      const lines = blocks[to].split('\n')
      if (target.above) lines.unshift(imgLine)
      else lines.push(imgLine)
      blocks[to] = lines.join('\n')
    }
    state.setImageSide(noteId, src, target.side)
    state.updateNote(noteId, { content: joinBlocks(blocks) })
    // Commit any in-progress edit first so the rewrite renders immediately.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
  const imagesControls = useMemo<ImageControls>(
    () => ({
      docked: new Set(Object.keys(docked.sides)),
      sides: docked.sides,
      widths: docked.widths,
      onToggleFloat: toggleFloat,
      onCommitWidth: commitWidth,
      onSetSide: (src, side) => useAppStore.getState().setImageSide(noteId, src, side),
      onLock: (src) => useAppStore.getState().clearImageFloat(noteId, src),
      onCommitMove: commitMove
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docked, noteId]
  )

  if (!note) {
    return (
      <main className="note note--empty">
        <FileTextIcon size={28} />
        <p>Select a note from the sidebar, or create a new one.</p>
      </main>
    )
  }

  const addPicture = async (): Promise<void> => {
    try {
      const result = await window.api.vault.importPicture()
      if (!result) return // user canceled the picker
      appendBlocks([result.markdown])
    } catch (error) {
      console.error('[note] picture import failed', error)
    }
  }

  const appendBlocks = (blocks: string[]): void => {
    if (blocks.length === 0) return
    const body = note.content.trimEnd()
    updateNote(note.id, { content: `${body}${body ? '\n\n' : ''}${blocks.join('\n\n')}\n` })
  }

  const dragTypes = (event: React.DragEvent): string[] => Array.from(event.dataTransfer.types ?? [])

  // Highlight ring only for plausible picture drags. The drop itself is
  // allowed more liberally (see below): some platforms report an empty type
  // list on dragover while still delivering Files on drop.
  const isPictureDrag = (event: React.DragEvent): boolean =>
    dragTypes(event).some((type) => type === 'Files' || type === 'text/uri-list')

  const onDropPictures = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    setDropActive(false)
    // End any in-progress block edit first: the editor only adopts outside
    // changes while unfocused, so without this a mid-edit drop would land in
    // the store yet stay invisible until the next blur.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const blocks: string[] = []
    const dropped = Array.from(event.dataTransfer.files ?? [])
    console.info(`[note] drop: ${dropped.length} file(s)`)
    const failures: string[] = []
    for (const file of dropped) {
      try {
        blocks.push(await importDroppedPicture(file))
      } catch (error) {
        console.error('[note] picture drop failed', error)
        failures.push(error instanceof Error ? error.message : `${file.name} (import failed)`)
      }
    }
    // Image/link drags from browsers arrive as a URL list. Plain-text drags
    // are ignored so a text selection never becomes a picture.
    const urls = event.dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line))
    for (const url of urls) {
      let alt = 'image'
      try {
        alt = new URL(url).hostname || alt
      } catch {
        // keep the fallback label
      }
      blocks.push(`![${alt}](${url})`)
    }
    if (blocks.length > 0) {
      appendBlocks(blocks)
      flashDropStatus(`Added ${blocks.length} picture${blocks.length === 1 ? '' : 's'}`, false)
    } else if (dropped.length > 0 || urls.length > 0) {
      flashDropStatus(`Couldn't add the drop: ${failures.join('; ') || 'unknown reason'}`, true)
    } else {
      flashDropStatus('The drop arrived with no files — try the picture button instead', true)
    }
  }

  return (
    <main
      ref={noteRef}
      className="note"
      onDragOver={(event) => {
        const types = dragTypes(event)
        const plausible =
          types.length === 0 || types.some((t) => t === 'Files' || t === 'text/uri-list')
        // Plain-text drags keep native behavior (moving selected text);
        // everything else is a drop candidate so onDrop always fires.
        if (!plausible) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (isPictureDrag(event)) setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => void onDropPictures(event)}
    >
      <header className="note__bar">
        <span className="note__meta">
          Edited {edited}
          {note.fileName ? ` · ${note.fileName}` : ''}
        </span>
        <div className="note__actions">
          <button
            type="button"
            className="icon-btn"
            title="Add picture (local file or paste an image URL)"
            aria-label="Add picture"
            onClick={() => void addPicture()}
          >
            <ImageIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            title="Delete note"
            aria-label="Delete note"
            onClick={() => {
              const label = note.title.trim() || 'Untitled'
              if (
                window.confirm(`Delete "${label}"? You can restore it from Trash within 30 days.`)
              ) {
                deleteNote(note.id)
              }
            }}
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </header>

      {dropStatus && (
        <p className={`note__drop-status${dropStatus.error ? ' is-error' : ''}`} role="status">
          {dropStatus.msg}
        </p>
      )}

      <div className={`note__scroll${dropActive ? ' is-drop-target' : ''}`}>
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
            images={imagesControls}
          />
        </div>
      </div>

      {findOpen && note && (
        <FindBar scope={noteRef} content={note.content} onClose={() => setFindOpen(false)} />
      )}

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
          <kbd>```js</kbd> + Go
        </span>
        <span>
          <kbd>[[link]]</kbd> pages
        </span>
        <span>
          <kbd>img</kbd> hover → Unlock
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>F</kbd> find
        </span>
      </footer>
    </main>
  )
}

export default Note
