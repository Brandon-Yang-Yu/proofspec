/**
 * The capability file's format, defined once for both directions. Reading and writing are
 * separate jobs, but they are two views of one format: if a heading or an entry meant
 * something different to the reader than to the writer, the tool that writes a file and
 * the tool that verifies it would disagree about the same bytes.
 */

import type { ScenarioNode } from '../spec-tree/index.ts'

const REQUIREMENT_HEADING = '### Requirement:'
export const BLOCK_OPEN = '<!-- scenarios: generated -->'
export const BLOCK_CLOSE = '<!-- /scenarios -->'
const CODE_FENCE = '```'
const ENTRY_OPEN = '- "'
const ENTRY_SEPARATOR = '" → '

/**
 * A capability file's lines, each marked for whether it sits inside a code fence. The two
 * travel together because the mask only means anything about the lines it was built from,
 * and holding them apart would let a caller pair one file's lines with another's mask.
 */
export type Markdown = {
  readonly lines: readonly string[]
  readonly fenced: readonly boolean[]
}

/** A run of lines, `to` exclusive. */
export type LineRange = {
  readonly from: number
  readonly to: number
}

/**
 * Where a requirement's generated block sits, or that it has none yet.
 *
 * The two ranges are decided here, together: the reader parses exactly the lines the
 * write-back replaces. Working them out separately is how the tool that writes a file and
 * the tool that verifies it come to disagree about the same bytes.
 */
export type GeneratedBlock =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present'
      /** The lines the block records. */
      readonly entries: LineRange
      /** The lines the write-back replaces, its markers included. */
      readonly replaced: LineRange
    }

/**
 * One `### Requirement:` heading and everything under it, as line indices into the source.
 * Line indices rather than text, because the write-back has to put the file back together
 * with every line it did not touch exactly as it found it.
 */
export type RequirementSection = {
  readonly requirement: string
  /** 0-based index of the heading line. */
  readonly headingLine: number
  /** 0-based index of the first line past the section: the next heading, or the end. */
  readonly endLine: number
  readonly block: GeneratedBlock
}

/**
 * A source split into lines and masked for code fences.
 *
 * A capability file may show an example of itself, and a heading or a marker in that
 * example is neither — it is what the file says the format looks like, not the file using
 * it. Only a fence that is closed again masks anything: an opening fence nobody closed is
 * a typo, and reading the rest of the file as an example would leave the write-back
 * appending a block below it on every run, growing a file it can never bring to rest.
 */
export function readMarkdown(source: string): Markdown {
  const lines = source.split('\n')
  const fences = lines.flatMap((line, index) =>
    line.trimStart().startsWith(CODE_FENCE) ? [index] : [],
  )

  const fenced = lines.map(() => false)
  const paired = fences.length - (fences.length % 2)
  for (let fence = 0; fence < paired; fence += 2) {
    for (let index = fences[fence]!; index <= fences[fence + 1]!; index++) fenced[index] = true
  }
  return { lines, fenced }
}

/**
 * Lines back into one source. Paired with `readMarkdown`, because a file that was split
 * one way and joined another comes back changed, and changing nothing is this capability's
 * whole promise.
 */
export function toSource(lines: readonly string[]): string {
  return lines.join('\n')
}

/** The requirement sections in the order the file declares them. */
export function findSections(markdown: Markdown): RequirementSection[] {
  const headings = markdown.lines.flatMap((line, index) =>
    !markdown.fenced[index] && line.startsWith(REQUIREMENT_HEADING) ? [index] : [],
  )

  return headings.map((headingLine, position) => {
    const endLine = headings[position + 1] ?? markdown.lines.length
    return {
      requirement: markdown.lines[headingLine]!.slice(REQUIREMENT_HEADING.length).trim(),
      headingLine,
      endLine,
      block: findBlock(markdown, { from: headingLine + 1, to: endLine }),
    }
  })
}

/**
 * A marker is a line that is nothing but the marker. One written with an indent is left as
 * prose rather than adopted, so the reader and the write-back agree about it: adopting it
 * would mean writing the line back unindented, which is a line outside the block content
 * and not the write-back's to change.
 */
function findBlock(markdown: Markdown, section: LineRange): GeneratedBlock {
  for (let index = section.from; index < section.to; index++) {
    if (markdown.fenced[index] || markdown.lines[index]!.trimEnd() !== BLOCK_OPEN) continue
    return presentBlock(markdown, index, section.to)
  }
  return { kind: 'absent' }
}

/**
 * A block runs to its closing marker. One with no closing marker ends at the last written
 * line of the section, so the blank lines before the next heading stay outside it and the
 * write-back gives the block back the marker it lost.
 */
function presentBlock(markdown: Markdown, openLine: number, sectionEnd: number): GeneratedBlock {
  for (let index = openLine + 1; index < sectionEnd; index++) {
    if (markdown.fenced[index] || markdown.lines[index]!.trimEnd() !== BLOCK_CLOSE) continue
    return {
      kind: 'present',
      entries: { from: openLine + 1, to: index },
      replaced: { from: openLine, to: index + 1 },
    }
  }

  const lastEntry = lastWrittenLine(markdown.lines, openLine, sectionEnd)
  return {
    kind: 'present',
    entries: { from: openLine + 1, to: lastEntry + 1 },
    replaced: { from: openLine, to: lastEntry + 1 },
  }
}

/** The last line in `[from, to)` that holds something, or `from` when none of them do. */
export function lastWrittenLine(lines: readonly string[], from: number, to: number): number {
  for (let index = to - 1; index > from; index--) {
    if (lines[index]!.trim() !== '') return index
  }
  return from
}

/**
 * One recorded entry: the scenario's title and the file that proves it, and nothing else.
 * No line number, because a line moves whenever anyone edits a test; no Gherkin, because
 * it lives above the proof site and a second copy is the drift this tool exists to stop.
 */
export function renderEntry(entry: ScenarioNode): string {
  return `${ENTRY_OPEN}${entry.scenario}${ENTRY_SEPARATOR}${entry.file}`
}

/**
 * The entry a line records, or nothing when it records none. A line inside the block that
 * is not an entry records no scenario, so the guard reports that scenario as unrecorded
 * and the build fails — which is what a mangled block should do.
 *
 * The separator is found from the end, so a title holding the separator itself comes back
 * whole. A title is the scenario's identity, and a mangled one is a different scenario.
 */
export function parseEntry(line: string): ScenarioNode | undefined {
  const text = line.trim()
  if (!text.startsWith(ENTRY_OPEN)) return undefined

  // Either no separator at all, or one before the title could have started: both mean the
  // line is prose that happens to begin like an entry.
  const separator = text.lastIndexOf(ENTRY_SEPARATOR)
  if (separator < ENTRY_OPEN.length) return undefined

  const scenario = text.slice(ENTRY_OPEN.length, separator)
  const file = text.slice(separator + ENTRY_SEPARATOR.length).trim()
  if (file === '') return undefined
  return { scenario, file }
}
