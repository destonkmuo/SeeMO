import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  blockKind,
  blockToEditableHtml,
  editableToMarkdown,
  inlineToHtml,
  type BlockKind
} from '../richText'
import { filteredSlash, slashToken, type ChildKind, type SlashCommand } from '../slash'
import SlashMenu from './SlashMenu'

interface RichBlockEditorProps {
  /** Row index; used by the parent for focus lookups. */
  index: number
  /** Raw markdown for this block. */
  block: string
  placeholder?: string
  /** Commit the serialized markdown for this block. */
  onChange: (markdown: string) => void
  /** Replace this block's markdown and open a new block below. */
  onSplit: (beforeMarkdown: string, afterMarkdown: string) => void
  /** Backspace at the very start: merge into the previous block. */
  onMergePrev: () => void
  /** Arrow at the block edge: move to the neighbouring block. */
  onNavigate: (dir: 'up' | 'down') => void
  /** Alt+Arrow: reorder this block. */
  onMoveBlock: (dir: 'up' | 'down') => void
  /** Escape: leave edit mode. */
  onEscape: () => void
  /** Slash child actions (new page / flashcards / …). */
  onCreateChild?: (kind: ChildKind) => string | null
  /** Triple-click: fall back to editing this block's raw markdown. */
  onRequestRaw?: () => void
  /** Where to drop the caret when the editor first mounts. */
  initialCaret?: 'start' | 'end'
}

/** Character offset of the caret within `el`'s text. */
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

/** Text before the caret within `el`. */
function textBeforeCaret(el: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return ''
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString()
}

/** Locate a character offset inside `el` as a DOM position. */
function locate(el: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) return { node, offset: remaining }
    remaining -= len
    node = walker.nextNode()
  }
  return null
}

function setCaretOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const at = locate(el, offset)
  if (at) {
    range.setStart(at.node, at.offset)
    range.collapse(true)
  } else {
    range.selectNodeContents(el)
    range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

function rangeAtOffsets(el: HTMLElement, start: number, end: number): Range {
  const range = document.createRange()
  const s = locate(el, start)
  const e = locate(el, end)
  if (s) range.setStart(s.node, s.offset)
  else {
    range.selectNodeContents(el)
    range.collapse(true)
  }
  if (e) range.setEnd(e.node, e.offset)
  else range.selectNodeContents(el)
  return range
}

function fragmentToMarkdown(fragment: DocumentFragment, kind: BlockKind): string {
  const div = document.createElement('div')
  div.appendChild(fragment)
  return editableToMarkdown(div, kind)
}

function closestWithin(node: Node | null, tag: string, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== root) {
    if (cur instanceof HTMLElement && cur.tagName.toLowerCase() === tag) return cur
    cur = cur.parentNode
  }
  return null
}

function unwrap(el: HTMLElement): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
  parent.normalize()
}

/**
 * Notion-style rich block editor: while a block is active it shows the
 * *formatted* result (bold, lists, quotes, checkboxes) rather than raw
 * markdown. Every edit is re-serialized to markdown immediately, so the note
 * (and the `.md` file) stays plain text under the WYSIWYG surface.
 *
 * The DOM is intentionally uncontrolled while editing — the browser owns the
 * caret and structure; React only seeds the initial HTML and reads it back on
 * input/blur.
 */
function RichBlockEditor({
  index,
  block,
  placeholder,
  onChange,
  onSplit,
  onMergePrev,
  onNavigate,
  onMoveBlock,
  onEscape,
  onCreateChild,
  onRequestRaw,
  initialCaret = 'end'
}: RichBlockEditorProps): React.JSX.Element {
  const [seed, setSeed] = useState(() => ({
    html: blockToEditableHtml(block),
    kind: blockKind(block),
    key: 0
  }))
  const [slash, setSlash] = useState<string | null>(null)
  const [slashSel, setSlashSel] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const caretRef = useRef<'start' | 'end'>(initialCaret)

  const commit = useCallback(() => {
    const el = ref.current
    if (!el) return
    onChange(editableToMarkdown(el, seed.kind))
  }, [onChange, seed.kind])

  const refreshSlash = (): void => {
    const el = ref.current
    if (!el) return
    const token = slashToken(textBeforeCaret(el), getCaretOffset(el))
    if (token === null) {
      if (slash !== null) setSlash(null)
      return
    }
    if (slash === null || slash !== token) {
      setSlashSel(0)
      setSlash(token)
    }
  }

  // Focus and place the caret whenever the editor (re)seeds.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    setCaretOffset(el, caretRef.current === 'start' ? 0 : (el.textContent ?? '').length)
    caretRef.current = 'end'
  }, [seed.key])

  const insertTextAtCaret = useCallback((text: string) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  const insertHtmlAtCaret = useCallback((html: string) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const template = document.createElement('template')
    template.innerHTML = html
    const last = template.content.lastChild
    range.insertNode(template.content)
    if (last) {
      range.setStartAfter(last)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [])

  /** Delete the `/token` immediately before the caret. */
  const removeSlashToken = useCallback(() => {
    const el = ref.current
    if (!el) return
    const offset = getCaretOffset(el)
    const token = slashToken(textBeforeCaret(el), offset)
    if (token === null) return
    rangeAtOffsets(el, Math.max(0, offset - token.length - 1), offset).deleteContents()
  }, [])

  /** Swap this block's markdown wholesale and re-render its editable HTML. */
  const reseed = useCallback(
    (markdown: string) => {
      const kind = blockKind(markdown)
      onChange(markdown)
      caretRef.current = 'end'
      setSeed({ html: blockToEditableHtml(markdown), kind, key: Date.now() })
    },
    [onChange]
  )

  const applySlash = useCallback(
    (cmd: SlashCommand) => {
      const el = ref.current
      if (!el) return
      setSlash(null)
      if (cmd.childKind) {
        const link = onCreateChild?.(cmd.childKind) ?? null
        if (!link) return
        removeSlashToken()
        insertTextAtCaret(link)
        commit()
        return
      }
      removeSlashToken()
      if (cmd.id === 'link') {
        insertHtmlAtCaret(inlineToHtml('[link](url)'))
        commit()
        return
      }
      if (cmd.id === 'image') {
        insertHtmlAtCaret(inlineToHtml('![image](url)'))
        commit()
        return
      }
      if (cmd.id === 'math') {
        insertHtmlAtCaret(inlineToHtml('$x$'))
        commit()
        return
      }
      const lines = editableToMarkdown(el, seed.kind)
        .split('\n')
        .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]|\d+\.|>)\s+/, ''))
      const text = lines.join(' ').trim()
      let markdown: string
      switch (cmd.id) {
        case 'h1':
          markdown = `# ${text}`
          break
        case 'h2':
          markdown = `## ${text}`
          break
        case 'h3':
          markdown = `### ${text}`
          break
        case 'bullet':
          markdown = lines.map((line) => `- ${line}`).join('\n')
          break
        case 'numbered':
          markdown = lines.map((line, i) => `${i + 1}. ${line}`).join('\n')
          break
        case 'todo':
          markdown = lines.map((line) => `- [ ] ${line}`).join('\n')
          break
        case 'quote':
          markdown = lines.map((line) => `> ${line}`).join('\n')
          break
        case 'divider':
          markdown = '---'
          break
        case 'code':
          markdown = '```js\n\n```'
          break
        case 'mathblock':
          markdown = '$$\n\n$$'
          break
        default:
          markdown = text
      }
      reseed(markdown)
    },
    [
      commit,
      insertHtmlAtCaret,
      insertTextAtCaret,
      onCreateChild,
      removeSlashToken,
      reseed,
      seed.kind
    ]
  )

  const wrapSelection = useCallback(
    (tag: string) => {
      const el = ref.current
      if (!el) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (range.collapsed) return
      const existing = closestWithin(range.commonAncestorContainer, tag, el)
      if (existing) {
        unwrap(existing)
        commit()
        return
      }
      const wrapper = document.createElement(tag)
      try {
        range.surroundContents(wrapper)
      } catch {
        wrapper.appendChild(range.extractContents())
        range.insertNode(wrapper)
      }
      const after = document.createRange()
      after.selectNodeContents(wrapper)
      sel.removeAllRanges()
      sel.addRange(after)
      commit()
    },
    [commit]
  )

  const splitBlock = useCallback(
    (nextKind: BlockKind) => {
      const el = ref.current
      const sel = window.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const pre = document.createRange()
      pre.selectNodeContents(el)
      pre.setEnd(range.startContainer, range.startOffset)
      const post = document.createRange()
      post.selectNodeContents(el)
      post.setStart(range.endContainer, range.endOffset)
      const before = fragmentToMarkdown(pre.cloneContents(), seed.kind)
      const after = fragmentToMarkdown(post.cloneContents(), nextKind)
      onSplit(before, after)
    },
    [onSplit, seed.kind]
  )

  const currentLi = useCallback((): HTMLElement | null => {
    const el = ref.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0) return null
    let node: Node | null = sel.getRangeAt(0).startContainer
    while (node && node !== el) {
      if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'li') return node
      node = node.parentNode
    }
    return null
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = event.currentTarget

    // The `/` menu owns Enter/Tab/arrows/Esc while open.
    if (slash !== null) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return
      }
      const items = filteredSlash(slash)
      if (items.length === 0) {
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
        applySlash(items[slashSel % items.length])
        return
      }
    }

    // Inline formatting shortcuts.
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase()
      const tag =
        key === 'b' && !event.shiftKey
          ? 'strong'
          : key === 'i' && !event.shiftKey
            ? 'em'
            : key === 'e' && !event.shiftKey
              ? 'code'
              : key === 'h' && event.shiftKey
                ? 'mark'
                : key === 'x' && event.shiftKey
                  ? 'del'
                  : null
      if (tag) {
        event.preventDefault()
        wrapSelection(tag)
        return
      }
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      splitBlock(seed.kind === 'heading' ? 'paragraph' : seed.kind)
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (seed.kind === 'heading') {
        event.preventDefault()
        splitBlock('paragraph')
        return
      }
      if (seed.kind === 'bullet' || seed.kind === 'ordered' || seed.kind === 'task') {
        const li = currentLi()
        if (li && !(li.textContent ?? '').trim()) {
          event.preventDefault()
          li.remove()
          const current =
            el.querySelectorAll('li').length === 0 ? '' : editableToMarkdown(el, seed.kind)
          onSplit(current, '')
          return
        }
      }
      return
    }

    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (event.shiftKey) {
        const offset = getCaretOffset(el)
        if (offset === 0) return
        const text = textBeforeCaret(el)
        const remove = text.endsWith('  ') ? 2 : text.endsWith(' ') ? 1 : 0
        if (remove === 0) return
        rangeAtOffsets(el, offset - remove, offset).deleteContents()
        commit()
        return
      }
      insertTextAtCaret('  ')
      commit()
      return
    }

    if (
      event.key === 'Backspace' &&
      !event.shiftKey &&
      getCaretOffset(el) === 0 &&
      !textBeforeCaret(el)
    ) {
      const li = currentLi()
      if (li && !(li.textContent ?? '').trim()) {
        event.preventDefault()
        li.remove()
        if (el.querySelectorAll('li').length === 0) onChange('')
        else onChange(editableToMarkdown(el, seed.kind))
        return
      }
      event.preventDefault()
      onMergePrev()
      return
    }

    if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const offset = getCaretOffset(el)
      const total = (el.textContent ?? '').length
      if (event.key === 'ArrowUp' && offset === 0) {
        event.preventDefault()
        onNavigate('up')
        return
      }
      if (event.key === 'ArrowDown' && offset >= total) {
        event.preventDefault()
        onNavigate('down')
        return
      }
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onMoveBlock(event.key === 'ArrowUp' ? 'up' : 'down')
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      commit()
      onEscape()
    }
  }

  const onInput = (): void => {
    commit()
    refreshSlash()
  }

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    insertTextAtCaret(event.clipboardData.getData('text/plain'))
    commit()
  }

  return (
    <>
      <div
        key={seed.key}
        ref={ref}
        data-block={index}
        className={`block markdown rblock rblock--${seed.kind}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label="Edit block"
        data-placeholder={placeholder}
        dangerouslySetInnerHTML={{ __html: seed.html }}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={() => {
          commit()
          setSlash(null)
        }}
        onPaste={onPaste}
        onClick={(event) => {
          const target = event.target
          // Triple-click: hand off to raw markdown editing for this block.
          if (event.detail >= 3) {
            event.preventDefault()
            commit()
            onRequestRaw?.()
            return
          }
          // Links are edited, not followed, while the block is open.
          if (target instanceof HTMLElement && target.closest('a')) {
            event.preventDefault()
            return
          }
          // Toggling a task checkbox is a content change; commit it.
          if (target instanceof HTMLElement && target.matches('input[type="checkbox"]')) {
            window.setTimeout(commit, 0)
          }
        }}
      />
      {slash !== null && (
        <SlashMenu
          token={slash}
          selected={slashSel}
          onHover={setSlashSel}
          onPick={(cmd) => applySlash(cmd)}
        />
      )}
    </>
  )
}

export default RichBlockEditor
