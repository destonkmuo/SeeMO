import type { ReactNode } from 'react'
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { BULLET, FENCE, HEADING, ORDERED, QUOTE, RULE, TASK, splitBlocks } from '../markdown'
import { resolveWikiTarget } from '../notes'
import { useAppStore } from '../store/appStore'
import CodeBlock from './CodeBlock'

/**
 * Minimal markdown renderer for notes.
 *
 * Supports: headings, bold/italic/strikethrough, inline code, fenced code,
 * links, images, unordered/ordered/task lists, blockquotes, horizontal
 * rules, and LaTeX math (`$…$` inline, `$$…$$` display). Output is React
 * elements (never raw HTML) except KaTeX spans, whose markup is generated
 * by the KaTeX library itself (user input is escaped, never passed through),
 * so note content still cannot inject markup.
 */

// A single pass over inline tokens. Code spans come first so their contents
// are never re-parsed for emphasis or math. Display math comes before inline
// math so `$$x$$` is never split into two `$` matches. Wiki-links come before
// md-links so that `[[a]]` is never misread (it can't match the md-link shape
// anyway, which requires `](`, but explicit ordering keeps it obvious).
// Inline `$…$` requires non-space edges so prices like `$5 and $6` stay text.
const INLINE_RE =
  /(`[^`\n]+`)|(\$\$[^$\n]+\$\$)|(\$[^\s$](?:[^$\n]*[^\s$])?\$)|(\[\[[^\]\n]+\]\])|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(!?\[[^\]\n]*\]\([^)\n]*\))/g

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/)/i

function safeUrl(url: string): string | undefined {
  const trimmed = url.trim()
  return SAFE_URL.test(trimmed) ? trimmed : undefined
}

/** LaTeX math rendered by KaTeX. Falls back to a code span on failure. */
function Math({ tex, display }: { tex: string; display: boolean }): React.JSX.Element {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false })
    } catch {
      return null
    }
  }, [tex, display])
  if (html === null) return <code>{tex}</code>
  return (
    <span
      className={display ? 'math math--display' : 'math'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** A `[[Note]]` / `[[Note|alias]]` link: opens the note, or creates it. */
function WikiLink({ target, alias }: { target: string; alias: string }): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const live = notes.filter((note) => !note.deletedAt)
  const resolved = resolveWikiTarget(target, live)
  return (
    <button
      type="button"
      className={`markdown__wiki${resolved ? '' : ' markdown__wiki--missing'}`}
      title={resolved ? `Open ${target}` : `Create ${target}`}
      onClick={() => {
        const { notes, openNote, createNote } = useAppStore.getState()
        const live = notes.filter((note) => !note.deletedAt)
        const id = resolveWikiTarget(target, live)
        openNote(id ?? createNote(target))
      }}
    >
      {alias}
    </button>
  )
}

function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0
  let match: RegExpExecArray | null

  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index))
    }

    const token = match[0]
    const key = `${prefix}-${index++}`

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('$$')) {
      nodes.push(<Math key={key} tex={token.slice(2, -2)} display />)
    } else if (token.startsWith('$')) {
      nodes.push(<Math key={key} tex={token.slice(1, -1)} display={false} />)
    } else if (token.startsWith('[[')) {
      const inner = token.slice(2, -2)
      const pipe = inner.indexOf('|')
      const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim()
      const alias = (pipe < 0 ? inner : inner.slice(pipe + 1)).trim() || target
      if (target) {
        nodes.push(<WikiLink key={key} target={target} alias={alias} />)
      } else {
        nodes.push(token)
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token)
      const url = link ? safeUrl(link[3]) : undefined
      if (link && url) {
        nodes.push(
          link[1] === '!' ? (
            <img key={key} src={url} alt={link[2]} />
          ) : (
            <a key={key} href={url} target="_blank" rel="noreferrer">
              {link[2] || url}
            </a>
          )
        )
      } else {
        nodes.push(token)
      }
    }

    last = match.index + token.length
  }

  if (last < text.length) {
    nodes.push(text.slice(last))
  }
  return nodes
}

function heading(level: number, children: ReactNode, key: string): ReactNode {
  switch (level) {
    case 1:
      return <h1 key={key}>{children}</h1>
    case 2:
      return <h2 key={key}>{children}</h2>
    case 3:
      return <h3 key={key}>{children}</h3>
    case 4:
      return <h4 key={key}>{children}</h4>
    case 5:
      return <h5 key={key}>{children}</h5>
    default:
      return <h6 key={key}>{children}</h6>
  }
}

/** Render one already-split block. */
function renderBlock(block: string, key: number): ReactNode {
  const lines = block.split('\n')
  const first = lines[0]

  if (FENCE.test(first)) {
    const lang = first.trim().slice(3).trim()
    const hasClose = lines.length > 1 && FENCE.test(lines[lines.length - 1])
    const body = lines.slice(1, hasClose ? -1 : undefined)
    return <CodeBlock key={key} code={body.join('\n')} lang={lang} />
  }

  if (RULE.test(first)) {
    return <hr key={key} />
  }

  // Display math block: `$$…$$` (single or multi-line, no blank lines inside).
  const trimmed = block.trim()
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return <Math key={key} tex={trimmed.slice(2, -2).trim()} display />
  }

  const head = HEADING.exec(first)
  if (head) {
    return heading(head[1].length, renderInline(head[2], `h${key}`), `b${key}`)
  }

  if (QUOTE.test(first)) {
    const body = lines.map((line) => QUOTE.exec(line)?.[1] ?? line)
    return <blockquote key={key}>{renderInline(body.join(' '), `q${key}`)}</blockquote>
  }

  if (TASK.test(first)) {
    return (
      <ul key={key} className="markdown__tasks">
        {lines.map((line, index) => {
          const task = TASK.exec(line)
          if (!task) return null
          return (
            <li key={index} className="markdown__task">
              <input type="checkbox" checked={task[1].toLowerCase() === 'x'} readOnly />
              <span>{renderInline(task[2], `t${key}-${index}`)}</span>
            </li>
          )
        })}
      </ul>
    )
  }

  if (BULLET.test(first)) {
    return (
      <ul key={key}>
        {lines.map((line, index) => {
          const item = BULLET.exec(line)
          return <li key={index}>{renderInline(item?.[1] ?? line, `u${key}-${index}`)}</li>
        })}
      </ul>
    )
  }

  if (ORDERED.test(first)) {
    return (
      <ol key={key}>
        {lines.map((line, index) => {
          const item = ORDERED.exec(line)
          return <li key={index}>{renderInline(item?.[1] ?? line, `o${key}-${index}`)}</li>
        })}
      </ol>
    )
  }

  // Paragraph — single newlines within a block become line breaks.
  return (
    <p key={key}>
      {lines.map((text, line) => (
        <span key={line}>
          {renderInline(text, `p${key}-${line}`)}
          {line < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  )
}

/** Render one markdown document as React elements. */
function Markdown({ source }: { source: string }): React.JSX.Element {
  return <>{splitBlocks(source).map((block, index) => renderBlock(block, index))}</>
}

export default Markdown
