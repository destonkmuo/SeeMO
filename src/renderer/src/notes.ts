/**
 * Mapping between notes and vault files.
 *
 * Each note owns exactly one flat `.md` file named after its title
 * (`my-note.md`, `my-note-2.md` on collision). Titles stay human-readable in
 * the file manager; the store keeps the id <-> fileName mapping.
 */

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'untitled'
}

export function noteFileBase(title: string): string {
  return `${slugifyTitle(title)}.md`
}

/** Pick a name nobody else uses, adding a `-2`, `-3`, … suffix as needed. */
export function uniqueFileName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired
  const stem = desired.replace(/\.md$/i, '')
  let counter = 2
  let candidate = `${stem}-${counter}.md`
  while (taken.has(candidate)) {
    counter += 1
    candidate = `${stem}-${counter}.md`
  }
  return candidate
}

/** Recover a display title from a vault file name. */
export function titleFromFileName(fileName: string): string {
  const pretty = fileName.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim()
  return pretty || 'Untitled'
}

export interface WikiLink {
  /** Raw target as written, e.g. `My Note` in `[[My Note|alias]]`. */
  target: string
  /** Display text: the alias, or the target when there is none. */
  alias: string
}

const WIKI_RE = /\[\[([^\]\n]+?)\]\]/g

/**
 * Extract `[[Note]]` and `[[Note|alias]]` links from markdown source.
 * Code spans are skipped so `` `[[not-a-link]]` `` stays literal.
 */
export function parseWikiLinks(source: string): WikiLink[] {
  const withoutCode = source.replace(/`[^`\n]+`/g, (span) => ' '.repeat(span.length))
  const links: WikiLink[] = []
  WIKI_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKI_RE.exec(withoutCode)) !== null) {
    const inner = match[1]
    const pipe = inner.indexOf('|')
    const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim()
    if (!target) continue
    const alias = (pipe < 0 ? inner : inner.slice(pipe + 1)).trim() || target
    links.push({ target, alias })
  }
  return links
}

/** Minimal note shape needed for link resolution (avoids a store import). */
export interface LinkableNote {
  id: string
  title: string
}

/** Find the note a wiki-link points at, matching titles case-insensitively. */
export function resolveWikiTarget(target: string, notes: LinkableNote[]): string | null {
  const needle = target.trim().toLowerCase()
  if (!needle) return null
  return notes.find((note) => note.title.trim().toLowerCase() === needle)?.id ?? null
}

/**
 * Order notes for the sidebar: the persisted manual order first, then any
 * notes not yet positioned (new or freshly imported), most-recently-edited
 * first — which is also exactly the legacy behavior when no manual order
 * exists yet.
 */
export function orderedNotes<T extends { id: string; updatedAt: number }>(
  notes: T[],
  noteOrder: string[]
): T[] {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const known: T[] = []
  for (const id of noteOrder) {
    const note = byId.get(id)
    if (note) known.push(note)
  }
  const knownSet = new Set(known.map((note) => note.id))
  const missing = notes
    .filter((note) => !knownSet.has(note.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return [...missing, ...known]
}
