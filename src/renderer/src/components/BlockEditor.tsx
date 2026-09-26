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
  /** Skeleton to insert; `|` marks where the caret lands. Empty for actions. */
  insert: string
  /** App-level action instead of a text insert. */
  action?: 'create-note'
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
  },
  {
    id: 'page',
    title: 'New page',
    badge: '+',
    hint: 'create',
    keywords: 'new page note document create',
    insert: '',
    action: 'create-note'
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
  onCreateNote?: () => void
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
  images,
  onCreateNote
}: BlockEditorProps): React.JSX.Element {
  const [blocks, setBlocks] = useState<string[]>(() => splitBlocks(value))
  const [active, setActive] = useState<number | null>(null)
  // Multi-block selection: sorted list of selected row indices while NOT editing.
  // Shift+Click extends from the anchor, Cmd/Ctrl+Click toggles one row.
  const [selected, setSelected] = useState<number[]>([])
  // Merged edit: rows [from..to] shown as ONE textarea so the user can select
  // down to the character across block boundaries and delete/type natively.
  const [bulk, setBulk] = useState<{ from: number; to: number; text: string } | null>(null)
  const [dropHint, setDropHint] = useState<{ index: number; before: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [slash, setSlash] = useState<{ index: number; token: string } | null>(null)
  const [slashSel, setSlashSel] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<number | null>(null)
  const indentCaretRef = useRef<number | null>(null)
  const syncedRef = useRef(value)
  const dragFrom = useRef<number | null>(null)
  // Anchor row for Shift+Click range extension.
  const anchorRef = useRef<number | null>(null)
  const bulkRef = useRef<HTMLTextAreaElement | null>(null)
  // Pre-move row rects keyed by block text, consumed once for the FLIP glide.
  const flipRef = useRef<Map<string, DOMRect[]> | null>(null)

  // Adopt changes made elsewhere (vault refresh, note switch) unless the user
  // is mid-edit.
  useEffect(() => {
    if (active !== null || bulk !== null) return
    if (value !== syncedRef.current) {
      setBlocks(splitBlocks(value))
      syncedRef.current = value
      setSelected([])
      anchorRef.current = null
    }
  }, [value, active, bulk])

  const commit = useCallback(
    (next: string[]) => {
      const text = joinBlocks(next)
      setBlocks(next)
      syncedRef.current = text
      onChange(text)
    },
    [onChange]
  )

  const clearMulti = useCallback(() => {
    setSelected([])
    anchorRef.current = null
    setBulk(null)
  }, [])

  /** Delete whole selected rows (block-granular). Char-level delete happens
   * inside the merged bulk textarea instead. */
  const deleteSelected = useCallback(() => {
    const sel = selected.slice().sort((a, b) => a - b)
    if (sel.length === 0) return
    const drop = new Set(sel)
    let next = blocks.filter((_, i) => !drop.has(i))
    if (next.length === 0) next = ['']
    commit(next)
    clearMulti()
    setActive(null)
  }, [blocks, commit, selected, clearMulti])

  /** Merge rows [from..to] into one textarea for char-precise editing. */
  const enterBulk = useCallback(
    (from: number, to: number, caret: number | null = null) => {
      const lo = Math.max(0, Math.min(from, to))
      const hi = Math.min(blocks.length - 1, Math.max(from, to))
      if (hi < lo) return
      setActive(null)
      setSelected([])
      anchorRef.current = null
      setBulk({ from: lo, to: hi, text: joinBlocks(blocks.slice(lo, hi + 1)) })
      if (caret !== null) caretRef.current = caret
    },
    [blocks]
  )

  const commitBulk = useCallback(
    (text: string) => {
      setBulk((current) => {
        if (!current) return current
        const parts = splitBlocks(text)
        const next = [...blocks.slice(0, current.from), ...parts, ...blocks.slice(current.to + 1)]
        const finalBlocks = next.length > 0 ? next : ['']
        commit(finalBlocks)
        caretRef.current = null
        // Land single-edit on the last touched piece for continued typing.
        window.requestAnimationFrame(() => {
          setActive(Math.min(current.from + parts.length - 1, finalBlocks.length - 1))
        })
        return null
      })
    },
    [blocks, commit]
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

  // Bulk textarea: autofocus + autosize, then place a staged caret.
  useLayoutEffect(() => {
    if (!bulk) return
    const el = bulkRef.current
    if (!el) return
    if (document.activeElement !== el) el.focus()
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (caretRef.current !== null) {
      const pos = Math.max(0, Math.min(caretRef.current, el.value.length))
      el.setSelectionRange(pos, pos)
      caretRef.current = null
    }
  }, [bulk])

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
    clearMulti()
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
    if (active !== null || bulk !== null) {
      event.preventDefault()
      return
    }
    clearMulti()
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
    clearMulti()
    caretRef.current = blocks[index]?.length ?? 0
    setSlash(null)
    setActive(index)
  }

  /** Click on a rendered block: modifiers select, plain click edits.
   * A native drag-selection spanning rows becomes a multi-selection instead
   * of opening a single editor (which would destroy the selection). */
  const onViewClick = (event: React.MouseEvent, index: number): void => {
    const native = window.getSelection()
    if (
      native &&
      !native.isCollapsed &&
      containerRef.current?.contains(native.anchorNode) &&
      containerRef.current?.contains(native.focusNode)
    ) {
      const anchorRow =
        (native.anchorNode as Node | null) instanceof Element
          ? ((native.anchorNode as Element).closest?.('.block-row') as HTMLElement | null)
          : ((
              native.anchorNode as Node | null as unknown as { parentElement?: Element | null }
            )?.parentElement?.closest?.('.block-row') as HTMLElement | null)
      const focusRow =
        (native.focusNode as Node | null) instanceof Element
          ? ((native.focusNode as Element).closest?.('.block-row') as HTMLElement | null)
          : ((
              native.focusNode as Node | null as unknown as { parentElement?: Element | null }
            )?.parentElement?.closest?.('.block-row') as HTMLElement | null)
      const a = anchorRow?.dataset.row ? Number(anchorRow.dataset.row) : index
      const f = focusRow?.dataset.row ? Number(focusRow.dataset.row) : index
      if (
        Number.isFinite(a) &&
        Number.isFinite(f) &&
        a >= 0 &&
        f >= 0 &&
        a < blocks.length &&
        f < blocks.length &&
        a !== f
      ) {
        event.preventDefault()
        const lo = Math.min(a, f)
        const hi = Math.max(a, f)
        const range: number[] = []
        for (let i = lo; i <= hi; i++) range.push(i)
        setActive(null)
        setBulk(null)
        setSelected(range)
        anchorRef.current = a
        focusContainer()
        return
      }
      if (a !== f) {
        event.preventDefault()
        return
      }
    }
    if (event.shiftKey && anchorRef.current !== null) {
      event.preventDefault()
      const lo = Math.min(anchorRef.current, index)
      const hi = Math.max(anchorRef.current, index)
      const range: number[] = []
      for (let i = lo; i <= hi; i++) range.push(i)
      setActive(null)
      setBulk(null)
      setSelected(range)
      focusContainer()
      return
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      anchorRef.current = index
      setActive(null)
      setBulk(null)
      setSelected((prev) =>
        prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index].sort((a, b) => a - b)
      )
      focusContainer()
      return
    }
    anchorRef.current = index
    activate(index)
  }

  const onGripClick = (event: React.MouseEvent, index: number): void => {
    event.stopPropagation()
    if (event.shiftKey && anchorRef.current !== null) {
      const lo = Math.min(anchorRef.current, index)
      const hi = Math.max(anchorRef.current, index)
      const range: number[] = []
      for (let i = lo; i <= hi; i++) range.push(i)
      setActive(null)
      setBulk(null)
      setSelected(range)
      return
    }
    anchorRef.current = index
    setActive(null)
    setBulk(null)
    setSelected((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b)
    )
    focusContainer()
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
    // App actions (new page/note) don't touch the text.
    if (cmd.action === 'create-note') {
      setSlash(null)
      setActive(null)
      onCreateNote?.()
      return
    }
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
    // Shift+Arrow at the edge merges into a joint editor so a character
    // selection can continue across the block boundary natively.
    if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const text = blocks[index] ?? ''
      const start = el.selectionStart
      const end = el.selectionEnd
      if (event.shiftKey) {
        if (event.key === 'ArrowDown' && end >= text.length && !text.slice(end).includes('\n')) {
          if (index < blocks.length - 1) {
            event.preventDefault()
            enterBulk(index, index + 1, start)
            return
          }
        }
        if (event.key === 'ArrowUp' && start <= 0 && !text.slice(0, start).includes('\n')) {
          if (index > 0) {
            event.preventDefault()
            const prevLen = (blocks[index - 1] ?? '').length
            enterBulk(index - 1, index, prevLen + 2 + start)
            return
          }
        }
      }
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
    clearMulti()
    const next = blocks.slice()
    if (next[next.length - 1] !== '') next.push('')
    commit(next)
    caretRef.current = 0
    setActive(next.length - 1)
  }

  const focusContainer = (): void => {
    // Defer so the click's native selection settles first.
    window.requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }))
  }

  const onContainerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (active !== null || bulk !== null || selected.length === 0) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      deleteSelected()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const sorted = selected.slice().sort((a, b) => a - b)
      enterBulk(sorted[0], sorted[sorted.length - 1])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      clearMulti()
    }
  }

  const onCopyCut = (event: React.ClipboardEvent<HTMLDivElement>, cut: boolean): void => {
    if (active !== null || bulk !== null || selected.length === 0) return
    const sorted = selected.slice().sort((a, b) => a - b)
    // Only hijack when the native selection is inside our rows; otherwise
    // let inputs/menus copy normally.
    const native = window.getSelection()
    if (
      native &&
      !native.isCollapsed &&
      containerRef.current &&
      native.anchorNode &&
      native.focusNode &&
      !containerRef.current.contains(native.anchorNode)
    ) {
      return
    }
    event.preventDefault()
    const text = joinBlocks(sorted.map((i) => blocks[i] ?? ''))
    event.clipboardData.setData('text/plain', text)
    if (cut) deleteSelected()
  }

  return (
    <div
      className="blocks"
      ref={containerRef}
      tabIndex={-1}
      onClick={onContainerClick}
      onKeyDown={onContainerKeyDown}
      onCopy={(event) => onCopyCut(event, false)}
      onCut={(event) => onCopyCut(event, true)}
      onDragOver={onContainerDragOver}
      onDrop={onContainerDrop}
    >
      {selected.length > 0 && active === null && bulk === null && (
        <p className="block-row__multibar" role="status">
          {selected.length} {selected.length === 1 ? 'block' : 'blocks'} selected — Enter to edit
          together · Delete to remove · Esc to clear · Shift+Click extends
        </p>
      )}
      {blocks.map((block, index) => {
        // Rows inside a merged bulk edit are replaced by the single textarea.
        if (bulk && index > bulk.from && index <= bulk.to) return null
        const hint =
          dropHint && dropHint.index === index
            ? dropHint.before
              ? ' block-row--drop-before'
              : ' block-row--drop-after'
            : ''
        const dragging = draggingId === index ? ' block-row--dragging' : ''
        const isSel = selected.includes(index) ? ' block-row--selected' : ''
        const isBulkFrom = bulk && bulk.from === index
        return (
          <div
            key={`row-${index}`}
            data-row={index}
            className={`block-row${hint}${dragging}${isSel}`}
            onDragOver={(event) => onRowDragOver(event, index)}
            onDrop={(event) => onRowDrop(event, index)}
          >
            {isBulkFrom && bulk ? (
              <textarea
                ref={bulkRef}
                data-bulk="true"
                className="block__input block__input--bulk"
                value={bulk.text}
                rows={3}
                spellCheck={false}
                aria-label={`Editing blocks ${bulk.from + 1} to ${bulk.to + 1} together`}
                onChange={(event) => {
                  const next = event.target.value
                  setBulk((prev) => (prev ? { ...prev, text: next } : prev))
                  // Keep autosized while typing.
                  event.target.style.height = 'auto'
                  event.target.style.height = `${event.target.scrollHeight}px`
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    commitBulk((event.currentTarget as HTMLTextAreaElement).value)
                    return
                  }
                  // Plain Escape/blur commits; Cmd+Enter commits and stays.
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    commitBulk((event.currentTarget as HTMLTextAreaElement).value)
                  }
                }}
                onBlur={(event) => commitBulk(event.currentTarget.value)}
              />
            ) : (
              <>
                {index !== active && (
                  <span
                    className="block__grip"
                    draggable
                    role="button"
                    title="Drag to move · Click to select · Shift+Click to extend"
                    aria-label={`Drag to move block ${index + 1}`}
                    onClick={(event) => onGripClick(event, index)}
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
                        if (
                          event.key !== 'Enter' &&
                          event.key !== 'Tab' &&
                          event.key !== 'Escape'
                        ) {
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
                    onClick={(event) => onViewClick(event, index)}
                  >
                    {block.trim() ? (
                      <Markdown source={block} images={images} />
                    ) : index === 0 ? (
                      <span className="block__placeholder">{placeholder}</span>
                    ) : (
                      <span className="block__placeholder" aria-hidden="true" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default BlockEditor
