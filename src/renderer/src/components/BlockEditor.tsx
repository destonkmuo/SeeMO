import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { joinBlocks, splitBlocks } from '../markdown'
import Markdown from './Markdown'
import { GripIcon } from './icons'
import type { ImageControls } from '../images'

/** Native DnD payload marking a drag as a block reorder (not a picture). */
const BLOCK_MIME = 'application/x-seemo-block'

interface BlockEditorProps {
  /** Raw markdown for the whole note. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  images?: ImageControls
}

/**
 * Notion-style block editor.
 *
 * The document is shown as rendered markdown; clicking a block swaps just that
 * block for a textarea containing its raw markdown, so writing and preview are
 * the same surface. Enter adds a newline inside the block, Shift+Enter splits
 * a block, Tab indents (never leaves the editor), Backspace at the start
 * merges into the previous one, Escape leaves edit mode.
 */
function BlockEditor({
  value,
  onChange,
  placeholder,
  images
}: BlockEditorProps): React.JSX.Element {
  const [blocks, setBlocks] = useState<string[]>(() => splitBlocks(value))
  const [active, setActive] = useState<number | null>(null)
  const [dropHint, setDropHint] = useState<{ index: number; before: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<number | null>(null)
  const indentCaretRef = useRef<number | null>(null)
  const syncedRef = useRef(value)
  const dragFrom = useRef<number | null>(null)
  // Pre-move row rects keyed by block text, consumed once for the FLIP glide.
  const flipRef = useRef<Map<string, DOMRect[]> | null>(null)

  // Adopt changes made elsewhere (vault refresh, note switch) unless the user
  // is mid-edit.
  useEffect(() => {
    if (active !== null) return
    if (value !== syncedRef.current) {
      setBlocks(splitBlocks(value))
      syncedRef.current = value
    }
  }, [value, active])

  const commit = useCallback(
    (next: string[]) => {
      const text = joinBlocks(next)
      setBlocks(next)
      syncedRef.current = text
      onChange(text)
    },
    [onChange]
  )

  const editorFor = (index: number | null): HTMLTextAreaElement | null =>
    index === null
      ? null
      : (containerRef.current?.querySelector<HTMLTextAreaElement>(`[data-block="${index}"]`) ??
        null)

  // Focus and place the caret after a structural change.
  useLayoutEffect(() => {
    const el = editorFor(active)
    if (!el) return
    if (document.activeElement !== el) el.focus()
    if (caretRef.current !== null) {
      el.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
    }
  }, [active])

  // Keep the focused block's textarea exactly as tall as its content.
  // Also restores the caret after a same-block Tab indent.
  useLayoutEffect(() => {
    const el = editorFor(active)
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (indentCaretRef.current !== null && document.activeElement === el) {
      el.setSelectionRange(indentCaretRef.current, indentCaretRef.current)
      indentCaretRef.current = null
    }
  }, [blocks, active])

  const setBlockText = (index: number, text: string): void => {
    const next = blocks.slice()
    next[index] = text
    commit(next)
  }

  // After any reorder, glide rows from their old positions (FLIP) instead
  // of jumping. Keyed by block text; unmatched rows simply appear.
  useLayoutEffect(() => {
    const map = flipRef.current
    flipRef.current = null
    if (!map || !containerRef.current) return
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    const used = new Map<string, number>()
    const rows = containerRef.current.querySelectorAll('.block-row')
    blocks.forEach((text, index) => {
      const el = rows[index] as HTMLElement | undefined
      if (!el) return
      const list = map.get(text)
      if (!list) return
      const seen = used.get(text) ?? 0
      used.set(text, seen + 1)
      const old = list[seen]
      if (!old) return
      const dy = old.top - el.getBoundingClientRect().top
      if (Math.abs(dy) > 2) {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
          duration: 240,
          easing: 'cubic-bezier(0.32, 0.72, 0, 1)'
        })
      }
    })
  }, [blocks])

  /** Reorder blocks by drag or keyboard. The editing caret follows its block. */
  const moveBlock = (from: number, toIndex: number, before: boolean): void => {
    if (from === toIndex) return
    const next = blocks.slice()
    const [moved] = next.splice(from, 1)
    let insertAt = before ? toIndex : toIndex + 1
    if (from < insertAt) insertAt -= 1
    if (insertAt === from) return // dropped back where it was
    // Snapshot row positions for the FLIP glide after commit.
    const rows = containerRef.current?.querySelectorAll('.block-row')
    if (rows) {
      const map = new Map<string, DOMRect[]>()
      blocks.forEach((text, index) => {
        const el = rows[index] as HTMLElement | undefined
        if (!el) return
        const list = map.get(text) ?? []
        list.push(el.getBoundingClientRect())
        map.set(text, list)
      })
      flipRef.current = map
    }
    // Keep the caret when the block being edited is the one moving.
    if (active === from) {
      const editor = editorFor(active)
      if (editor) caretRef.current = editor.selectionStart
    }
    next.splice(insertAt, 0, moved)
    commit(next)
    if (active !== null) {
      if (active === from) {
        setActive(insertAt)
      } else {
        const shifted = active - (from < active ? 1 : 0)
        setActive(shifted + (insertAt <= shifted ? 1 : 0))
      }
    }
  }

  const clearDrag = (): void => {
    dragFrom.current = null
    setDraggingId(null)
    setDropHint(null)
  }

  const onGripDragStart = (event: React.DragEvent<HTMLSpanElement>, index: number): void => {
    // Grips only render on rendered blocks, but never yank a block out from
    // under an in-flight structural change either.
    if (active !== null) {
      event.preventDefault()
      return
    }
    dragFrom.current = index
    setDraggingId(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(BLOCK_MIME, String(index))
  }

  const hintFromEvent = (
    event: React.DragEvent<HTMLDivElement>,
    index: number
  ): { index: number; before: boolean } => {
    const box = event.currentTarget.getBoundingClientRect()
    return { index, before: event.clientY < box.top + box.height / 2 }
  }

  const onRowDragOver = (event: React.DragEvent<HTMLDivElement>, index: number): void => {
    if (dragFrom.current === null) return // picture drags belong to the note
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const hint = hintFromEvent(event, index)
    setDropHint((prev) =>
      prev && prev.index === hint.index && prev.before === hint.before ? prev : hint
    )
  }

  const onRowDrop = (event: React.DragEvent<HTMLDivElement>, index: number): void => {
    if (dragFrom.current === null) return
    event.preventDefault()
    event.stopPropagation()
    const from = dragFrom.current
    const hint = hintFromEvent(event, index)
    clearDrag()
    moveBlock(from, hint.index, hint.before)
  }

  // Dropping on the empty area under the last block appends to the end.
  const onContainerDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (dragFrom.current === null) return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropHint((prev) =>
      prev && prev.index === blocks.length - 1 && !prev.before
        ? prev
        : { index: blocks.length - 1, before: false }
    )
  }

  const onContainerDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (dragFrom.current === null) return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.stopPropagation()
    const from = dragFrom.current
    clearDrag()
    moveBlock(from, blocks.length - 1, false)
  }

  const activate = (index: number): void => {
    caretRef.current = blocks[index]?.length ?? 0
    setActive(index)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number): void => {
    const el = event.currentTarget

    // Plain Enter stays inside the block (default newline). Shift+Enter
    // splits the block at the caret into a new block below.
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      const caret = el.selectionStart
      const text = blocks[index]
      const next = blocks.slice()
      next[index] = text.slice(0, caret)
      next.splice(index + 1, 0, text.slice(caret))
      caretRef.current = 0
      commit(next)
      setActive(index + 1)
      return
    }

    // Tab indents inside the editor instead of jumping focus to the sidebar
    // search box. Shift+Tab outdents when possible. Ctrl/Cmd+Tab is left
    // alone for the global tab switcher.
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const text = blocks[index]
      const start = el.selectionStart
      const end = el.selectionEnd
      if (event.shiftKey) {
        const before = text.slice(0, start)
        const remove = before.endsWith('  ') ? 2 : before.endsWith('\t') ? 1 : 0
        if (remove === 0) return
        const nextText = text.slice(0, start - remove) + text.slice(end)
        indentCaretRef.current = start - remove
        setBlockText(index, nextText)
        return
      }
      const nextText = text.slice(0, start) + '  ' + text.slice(end)
      indentCaretRef.current = start + 2
      setBlockText(index, nextText)
      return
    }

    if (
      event.key === 'Backspace' &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0 &&
      index > 0
    ) {
      event.preventDefault()
      const next = blocks.slice()
      const merged = next[index - 1] + next[index]
      const caret = next[index - 1].length
      next.splice(index - 1, 2, merged)
      caretRef.current = caret
      commit(next)
      setActive(index - 1)
      return
    }

    // Alt+Arrow reorders the block being edited, keeping focus and caret.
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (event.key === 'ArrowUp' && index > 0) {
        moveBlock(index, index - 1, true)
      } else if (event.key === 'ArrowDown' && index < blocks.length - 1) {
        moveBlock(index, index + 1, false)
      }
      return
    }

    if (event.key === 'Escape') {
      setActive(null)
    }
  }

  // Clicking the empty area under the last block appends one.
  const onContainerClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const next = blocks.slice()
    if (next[next.length - 1] !== '') next.push('')
    commit(next)
    caretRef.current = 0
    setActive(next.length - 1)
  }

  return (
    <div
      className="blocks"
      ref={containerRef}
      onClick={onContainerClick}
      onDragOver={onContainerDragOver}
      onDrop={onContainerDrop}
    >
      {blocks.map((block, index) => {
        const hint =
          dropHint && dropHint.index === index
            ? dropHint.before
              ? ' block-row--drop-before'
              : ' block-row--drop-after'
            : ''
        const dragging = draggingId === index ? ' block-row--dragging' : ''
        return (
          <div
            key={`row-${index}`}
            className={`block-row${hint}${dragging}`}
            onDragOver={(event) => onRowDragOver(event, index)}
            onDrop={(event) => onRowDrop(event, index)}
          >
            {index !== active && (
              <span
                className="block__grip"
                draggable
                role="button"
                title="Drag to move block"
                aria-label={`Drag to move block ${index + 1}`}
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => onGripDragStart(event, index)}
                onDragEnd={clearDrag}
              >
                <GripIcon size={15} />
              </span>
            )}
            {index === active ? (
              <textarea
                key={`edit-${index}`}
                data-block={index}
                className="block__input"
                value={block}
                rows={1}
                spellCheck={false}
                placeholder={index === 0 ? placeholder : ''}
                onChange={(event) => setBlockText(index, event.target.value)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onBlur={() => setActive((current) => (current === index ? null : current))}
              />
            ) : (
              <div
                key={`view-${index}`}
                className="block markdown"
                role="button"
                tabIndex={-1}
                onClick={() => activate(index)}
              >
                {block.trim() ? (
                  <Markdown source={block} images={images} />
                ) : (
                  <span className="block__placeholder">
                    {index === 0 ? placeholder : 'Empty block'}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default BlockEditor
