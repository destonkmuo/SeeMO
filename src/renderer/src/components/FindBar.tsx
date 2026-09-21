import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from './icons'

/** Custom Highlight API (Chromium) for match paint without touching the DOM. */
function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

/** All case-insensitive matches as live ranges under root. */
function collectRanges(root: Element, query: string): Range[] {
  const ranges: Range[] = []
  const needle = query.toLowerCase()
  if (!needle) return ranges
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent) continue
    // Editable text isn't rendered; hidden UI isn't visible.
    if (parent.closest('textarea, input, [aria-hidden="true"]')) continue
    nodes.push(node)
  }
  for (const node of nodes) {
    const hay = node.data.toLowerCase()
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
      from = at + needle.length
    }
  }
  return ranges
}

/**
 * Floating find-in-note. Matches highlight across rendered blocks via the
 * Custom Highlight API (plain textareas being edited are skipped); Enter
 * jumps forward, Shift+Enter jumps back, Esc closes.
 */
function FindBar({
  scope,
  content,
  onClose
}: {
  /** Note root; search stays inside it (split view safe). */
  scope: React.RefObject<HTMLElement | null>
  /** Note markdown; rematches after every edit. */
  content: string
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState(() => window.getSelection()?.toString().slice(0, 100) ?? '')
  const [match, setMatch] = useState({ count: 0, index: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Esc anywhere closes the bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Rematch on query or content change. setMatch mirrors the external
  // Highlight registry sync below (one extra render per change, no cascade).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const clear = (): void => {
      if (!highlightsSupported()) return
      CSS.highlights.delete('note-find')
      CSS.highlights.delete('note-find-current')
    }
    const root = scope.current?.querySelector('.blocks')
    if (!root || !query) {
      rangesRef.current = []
      setMatch({ count: 0, index: 0 })
      clear()
      return
    }
    const ranges = collectRanges(root, query)
    rangesRef.current = ranges
    setMatch((prev) => ({
      count: ranges.length,
      index: ranges.length === 0 ? 0 : Math.min(prev.index, ranges.length - 1)
    }))
    if (highlightsSupported()) {
      CSS.highlights.set('note-find', new Highlight(...ranges))
    }
    return clear
  }, [query, content, scope])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Paint + reveal the current match.
  useEffect(() => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return
    const safe = ((match.index % ranges.length) + ranges.length) % ranges.length
    const current = ranges[safe]
    if (highlightsSupported()) {
      CSS.highlights.set('note-find-current', new Highlight(current))
    }
    current.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }, [match])

  // Highlights die with the bar.
  useEffect(
    () => () => {
      if (!highlightsSupported()) return
      CSS.highlights.delete('note-find')
      CSS.highlights.delete('note-find-current')
    },
    []
  )

  const step = (delta: number): void => {
    if (match.count === 0) return
    const count = match.count
    setMatch((prev) => ({ count: prev.count, index: (prev.index + delta + count) % count }))
  }

  return (
    <div className="findbar" role="search" aria-label="Find in note">
      <input
        ref={inputRef}
        className="findbar__input"
        value={query}
        placeholder="Find in note"
        spellCheck={false}
        aria-label="Find in note"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          }
        }}
      />
      <span className="findbar__count" aria-live="polite">
        {query
          ? match.count === 0
            ? '0 / 0'
            : `${(match.index % match.count) + 1} / ${match.count}`
          : ''}
      </span>
      <button
        type="button"
        className="findbar__btn"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        onClick={() => step(-1)}
      >
        <ChevronUpIcon size={14} />
      </button>
      <button
        type="button"
        className="findbar__btn"
        title="Next match (Enter)"
        aria-label="Next match"
        onClick={() => step(1)}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        className="findbar__btn"
        title="Close (Esc)"
        aria-label="Close find"
        onClick={onClose}
      >
        <XIcon size={14} />
      </button>
    </div>
  )
}

export default FindBar
