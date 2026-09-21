import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { joinBlocks, splitBlocks } from '../markdown'
import Markdown from './Markdown'
import { GripIcon } from './icons'
import type { ImageControls } from '../images'

/** Native DnD payload marking a drag as a block reorder (not a picture). */
const BLOCK_MIME = 'application/x-seemo-block'

interface SlashCommand {
  id: string
  title: string
  badge: string
  hint: string
  keywords: string
  /** Skeleton to insert; `|` marks where the caret lands. */
  insert: string
}

/**
 * `/` menu: inserts raw markdown skeletons (still saved as `$…$`, ```, …),
 * so the document stays plain text under the WYSIWYG surface.
 */
const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1', title: 'Heading 1', badge: 'H1', hint: '#', keywords: 'title header', insert: '# |' },
  {
    id: 'h2',
    title: 'Heading 2',
    badge: 'H2',
    hint: '##',
    keywords: 'title header',
    insert: '## |'
  },
  {
    id: 'h3',
    title: 'Heading 3',
    badge: 'H3',
    hint: '###',
    keywords: 'title header',
    insert: '### |'
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    badge: '•',
    hint: '-',
    keywords: 'unordered point',
    insert: '- |'
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    badge: '1.',
    hint: '1.',
    keywords: 'ordered',
    insert: '1. |'
  },
  {
    id: 'todo',
    title: 'To-do',
    badge: '☐',
    hint: '- [ ]',
    keywords: 'checkbox task check',
    insert: '- [ ] |'
  },
  { id: 'quote', title: 'Quote', badge: '>', hint: '>', keywords: 'cite callout', insert: '> |' },
  {
    id: 'divider',
    title: 'Divider',
    badge: '—',
    hint: '---',
    keywords: 'separator rule hr',
    insert: '---'
  },
  {
    id: 'code',
    title: 'Code block',
    badge: '{}',
    hint: '```js',
    keywords: 'snippet javascript runnable',
    insert: '```js\n|\n```'
  },
  {
    id: 'math',
    title: 'Math inline',
    badge: '∑',
    hint: '$…$',
    keywords: 'formula latex equation',
    insert: '$|$'
  },
  {
    id: 'mathblock',
    title: 'Math block',
    badge: '$$',
    hint: '$$…$$',
    keywords: 'display formula latex equation',
    insert: '$$\n|\n$$'
  },
  {
    id: 'image',
    title: 'Image',
    badge: 'img',
    hint: '![](url)',
    keywords: 'picture photo embed',
    insert: '![](|)'
  },
  {
    id: 'link',
    title: 'Link',
    badge: '[]',
    hint: '[text](url)',
    keywords: 'url href anchor',
    insert: '[|](url)'
  }
]

/**
 * Slash token before the caret on the current line (`/ma` in `hi /ma`),
 * or null. The char before `/` must be start/whitespace so `a/b` and
 * `https://` never open the menu.
 */
const slashToken = (value: string, caret: number): string | null => {
  const before = value.slice(0, caret)
  const line = before.slice(before.lastIndexOf('\n') + 1)
  const match = /(^|\s)\/([\w-]*)$/.exec(line)
  return match ? match[2] : null
}

const filteredSlash = (token: string): SlashCommand[] => {
  const needle = token.toLowerCase()
  if (!needle) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (cmd) => cmd.title.toLowerCase().includes(needle) || cmd.keywords.includes(needle)
  )
}

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
function SlashMenu({
  token,
  selected,
  onHover,
  onPick
}: {
  token: string
  selected: number
  onHover: (index: number) => void
  onPick: (cmd: SlashCommand) => void
}): React.JSX.Element {
  const items = filteredSlash(token)
  const safe = items.length === 0 ? 0 : selected % items.length
  return (
    <div className="slash-menu" role="listbox" aria-label="Insert block">
      {items.length === 0 ? (
        <p className="slash-menu__empty">No matches</p>
      ) : (
        items.map((cmd, i) => (
          <button
            key={cmd.id}
            type="button"
            role="option"
            aria-selected={i === safe}
            className={`slash-menu__item${i === safe ? ' is-selected' : ''}`}
            // mousedown default would blur the textarea (closing edit mode)
            // before click fires; prevent it so picking keeps the caret.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(cmd)}
            onMouseEnter={() => onHover(i)}
          >
            <span className="slash-menu__badge" aria-hidden="true">
              {cmd.badge}
            </span>
            <span className="slash-menu__title">{cmd.title}</span>
            <span className="slash-menu__hint">{cmd.hint}</span>
          </button>
        ))
      )}
    </div>
  )
}

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
  const [slash, setSlash] = useState<{ index: number; token: string } | null>(null)
  const [slashSel, setSlashSel] = useState(0)
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
  // Also restores the caret after a same-block Tab indent — or any same-block
  // commit that stages caretRef (slash-menu insert, Alt+Arrow landing here).
  useLayoutEffect(() => {
    const el = editorFor(active)
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (caretRef.current !== null && document.activeElement === el) {
      el.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
    }
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
    setSlash(null)
    setActive(index)
  }

  /** Refresh the `/` menu from the caret; call on change/click/keys. */
  const refreshSlash = (index: number, value: string, caret: number): void => {
    const token = slashToken(value, caret)
    if (token === null) {
      if (slash !== null) setSlash(null)
      return
    }
    if (slash === null || slash.index !== index || slash.token !== token) {
      setSlashSel(0)
      setSlash({ index, token })
    }
  }

  const applySlash = (index: number, cmd: SlashCommand): void => {
    const el = editorFor(index)
    const text = blocks[index] ?? ''
    const caret = el ? el.selectionStart : text.length
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1
    const match = /(^|\s)\/[\w-]*$/.exec(text.slice(lineStart, caret))
    if (!match) {
      setSlash(null)
      return
    }
    const slashStart = lineStart + match.index + match[1].length
    const marker = cmd.insert.indexOf('|')
    const head =
      marker >= 0 ? cmd.insert.slice(0, marker) + cmd.insert.slice(marker + 1) : cmd.insert
    caretRef.current = slashStart + (marker >= 0 ? marker : head.length)
    const next = blocks.slice()
    next[index] = text.slice(0, slashStart) + head + text.slice(caret)
    setSlash(null)
    commit(next)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number): void => {
    const el = event.currentTarget

    // The `/` menu owns Enter/Tab/arrows/Esc while open.
    if (slash && slash.index === index) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return
      }
      const items = filteredSlash(slash.token)
      if (items.length === 0) {
        // No match: dismiss and fall through to normal editing keys.
        setSlash(null)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSel((sel) => (sel + 1) % items.length)
        return
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSel((sel) => (sel - 1 + items.length) % items.length)
        return
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applySlash(index, items[slashSel % items.length])
        return
      }
    }

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

    // Plain Up/Down at the block's edge passes into the neighboring block
    // (Notion-style); otherwise the caret moves within the textarea.
    if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const text = blocks[index] ?? ''
      const start = el.selectionStart
      const end = el.selectionEnd
      if (start === end) {
        if (event.key === 'ArrowDown' && !text.slice(end).includes('\n')) {
          if (index < blocks.length - 1) {
            event.preventDefault()
            caretRef.current = Math.min(start, (blocks[index + 1] ?? '').length)
            setActive(index + 1)
          }
          return
        }
        if (event.key === 'ArrowUp' && !text.slice(0, start).includes('\n')) {
          if (index > 0) {
            event.preventDefault()
            caretRef.current = Math.min(start, (blocks[index - 1] ?? '').length)
            setActive(index - 1)
          }
          return
        }
      }
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
              <>
                <textarea
                  key={`edit-${index}`}
                  data-block={index}
                  className="block__input"
                  value={block}
                  rows={1}
                  spellCheck={false}
                  placeholder={index === 0 ? placeholder : ''}
                  onChange={(event) => {
                    setBlockText(index, event.target.value)
                    refreshSlash(index, event.target.value, event.target.selectionStart)
                  }}
                  onClick={(event) =>
                    refreshSlash(
                      index,
                      event.currentTarget.value,
                      event.currentTarget.selectionStart
                    )
                  }
                  onKeyDown={(event) => {
                    onKeyDown(event, index)
                    if (event.key !== 'Enter' && event.key !== 'Tab' && event.key !== 'Escape') {
                      // Caret may have moved (arrows, typing filtered above).
                      const el = event.currentTarget
                      window.requestAnimationFrame(() => {
                        if (document.activeElement === el) {
                          refreshSlash(index, el.value, el.selectionStart)
                        }
                      })
                    }
                  }}
                  onBlur={() => setActive((current) => (current === index ? null : current))}
                />
                {slash !== null && slash.index === index && (
                  <SlashMenu
                    token={slash.token}
                    selected={slashSel}
                    onHover={setSlashSel}
                    onPick={(cmd) => applySlash(index, cmd)}
                  />
                )}
              </>
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
