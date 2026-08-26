import { compareStrings } from '../order.ts'
import type { ScenarioNode } from '../spec-tree/index.ts'
import { findSections, findTermSections, parseEntry, readMarkdown } from './format.ts'
import type { RequirementSection, TermSection } from './format.ts'
import type { CapabilitySpec, RequirementSpec, TermSpec } from './types.ts'

/**
 * Reads one committed capability file: its requirements, the description written under
 * each, and the scenarios each records. It takes the file's text rather than its path —
 * opening files is `cli`'s job, and nothing here needs a filesystem.
 *
 * The capability's name comes from the caller, which knows the file it opened, rather than
 * from the file's own title. A title is prose the human owns, and making it load-bearing
 * would let a typo in a heading detach a whole capability from the tests that prove it.
 *
 * Requirements come back in the order the file declares them. That order is the human's:
 * descriptions refer to their neighbours, so a requirement re-ordered here turns "the
 * requirement below" into one above it on every page rendered from this read. Nothing
 * downstream compares requirements positionally — the guard keys them by name and the diff
 * by identity — so the read owes them no order of its own.
 */
export function readCapabilityFile(source: string, options: { capability: string }): CapabilitySpec {
  const markdown = readMarkdown(source)
  const termSections = findTermSections(markdown)
  const requirements = findSections(markdown).map(section =>
    toRequirementSpec(section, { lines: markdown.lines, termSections }),
  )
  return { capability: options.capability, requirements, terms: termsOf(termSections, markdown.lines) }
}

function toRequirementSpec(
  section: RequirementSection,
  from: { readonly lines: readonly string[]; readonly termSections: readonly TermSection[] },
): RequirementSpec {
  return {
    requirement: section.requirement,
    description: descriptionOf(section, from),
    scenarios: recordedEntries(section, from.lines),
  }
}

/** The file's vocabulary, as written. A Term heading inside a fence is an example, not a term. */
function termsOf(termSections: readonly TermSection[], lines: readonly string[]): TermSpec[] {
  return termSections.map(section => ({
    term: section.term,
    definition: lines.slice(section.headingLine + 1, section.endLine).join('\n').trim(),
  }))
}

/**
 * Just the terms a source declares. The second axis of `touched` reads these from two
 * revisions of a file and needs nothing else the read produces.
 */
export function readTerms(source: string): readonly TermSpec[] {
  const markdown = readMarkdown(source)
  return termsOf(findTermSections(markdown), markdown.lines)
}

/**
 * The prose between the heading and the generated block, with the blank lines around it
 * dropped. A Term heading ends the prose wherever it is written, because a definition is
 * never part of a description; where a section has no block, its description runs to the
 * next heading.
 */
function descriptionOf(
  section: RequirementSection,
  from: { readonly lines: readonly string[]; readonly termSections: readonly TermSection[] },
): string {
  const blockBegins = section.block.kind === 'present' ? section.block.replaced.from : section.endLine
  const termBegins = from.termSections.find(
    one => one.headingLine > section.headingLine && one.headingLine < blockBegins,
  )?.headingLine
  const proseEnd = termBegins ?? blockBegins
  return from.lines.slice(section.headingLine + 1, proseEnd).join('\n').trim()
}

/**
 * What the generated block records, in title order — the order `SpecTree` holds its
 * scenarios in, so a file that was read is already a branch of the tree the guard compares
 * against. A requirement with no block records nothing, which is what one looks like
 * before any test proves it.
 */
function recordedEntries(section: RequirementSection, lines: readonly string[]): ScenarioNode[] {
  if (section.block.kind === 'absent') return []
  const blockLines = lines.slice(section.block.entries.from, section.block.entries.to)
  const entries = blockLines.flatMap(line => {
    const entry = parseEntry(line)
    return entry === undefined ? [] : [entry]
  })
  return entries.sort((a, b) => compareStrings(a.scenario, b.scenario))
}

/**
 * The line each requirement heading is written on, 1-based, by requirement name. Delivered
 * on demand and never stored, the same rule a scenario's position follows: the heading moves
 * whenever a line above it does.
 *
 * It lives here because nothing outside `spec-file` knows the file is Markdown, so nothing
 * else could find the line without learning the format.
 */
export function requirementLines(source: string): ReadonlyMap<string, number> {
  const lines = new Map<string, number>()
  for (const section of findSections(readMarkdown(source))) {
    // A name written twice keeps the first heading: the guard warns about the repeat, and a
    // reader sent to the first one is sent to where the requirement was declared.
    if (lines.has(section.requirement)) continue
    lines.set(section.requirement, section.headingLine + 1)
  }
  return lines
}
