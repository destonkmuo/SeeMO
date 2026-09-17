import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { joinBlocks, splitBlocks } from '../markdown'
import Markdown from './Markdown'

interface BlockEditorProps {
  /** Raw markdown for the whole note. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/**
 * Notion-style block editor.
 *
 * The document is shown as rendered markdown; clicking a block swaps just that
 * block for a textarea containing its raw markdown, so writing and preview are
 * the same surface. Enter splits a block, Backspace at the start merges into
 * the previous one, Shift+Enter adds a line inside the block, Escape leaves
 * edit mode.
 */
function BlockEditor({ value, onChange, placeholder }: BlockEditorProps): React.JSX.Element {
  const [blocks, setBlocks] = useState<string[]>(() => splitBlocks(value))
  const [active, setActive] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<number | null>(null)
  const syncedRef = useRef(value)

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
  useLayoutEffect(() => {
    const el = editorFor(active)
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [blocks, active])

  const setBlockText = (index: number, text: string): void => {
    const next = blocks.slice()
    next[index] = text
    commit(next)
  }

  const activate = (index: number): void => {
    caretRef.current = blocks[index]?.length ?? 0
    setActive(index)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number): void => {
    const el = event.currentTarget

    if (event.key === 'Enter' && !event.shiftKey) {
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
    <div className="blocks" ref={containerRef} onClick={onContainerClick}>
      {blocks.map((block, index) =>
        index === active ? (
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
              <Markdown source={block} />
            ) : (
              <span className="block__placeholder">
                {index === 0 ? placeholder : 'Empty block'}
              </span>
            )}
          </div>
        )
      )}
    </div>
  )
}

export default BlockEditor
