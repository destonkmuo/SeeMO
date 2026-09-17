/**
 * Block-level markdown parsing shared by the renderer and the block editor.
 *
 * A "block" is one logical markdown construct: a heading, a run of list
 * items, a quote, a fenced code chunk, or a paragraph. Blocks are separated
 * by blank lines, which is what lets the editor treat the document as a list
 * of independently editable pieces (Notion-style) while keeping the rendered
 * output identical to the source.
 */

export const FENCE = /^\s*```/
export const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/
export const HEADING = /^(#{1,6})\s+(.*)$/
export const QUOTE = /^\s*>\s?(.*)$/
export const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
export const BULLET = /^\s*[-*+]\s+(.*)$/
export const ORDERED = /^\s*\d+\.\s+(.*)$/
export const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)/

/** Split a document into blank-line-separated markdown blocks. */
export function splitBlocks(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    // Blank lines only separate blocks — they are not content.
    while (i < lines.length && !lines[i].trim()) i++
    if (i >= lines.length) break

    const start = i

    if (FENCE.test(lines[i])) {
      // A fence swallows everything up to and including its closing marker.
      i++
      while (i < lines.length && !FENCE.test(lines[i])) i++
      if (i < lines.length) i++
    } else if (HEADING.test(lines[i]) || RULE.test(lines[i])) {
      i++
    } else if (TASK.test(lines[i]) || BULLET.test(lines[i])) {
      while (i < lines.length && (TASK.test(lines[i]) || BULLET.test(lines[i]))) i++
    } else if (ORDERED.test(lines[i])) {
      while (i < lines.length && ORDERED.test(lines[i])) i++
    } else if (QUOTE.test(lines[i])) {
      while (i < lines.length && QUOTE.test(lines[i])) i++
    } else {
      // Paragraph: consecutive plain lines.
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) i++
      if (i === start) i++
    }

    blocks.push(lines.slice(start, i).join('\n'))
  }

  return blocks.length > 0 ? blocks : ['']
}

/** Reassemble blocks into a document (one blank line between blocks). */
export function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n')
}
