import { compareStrings } from '../order.ts'
import type { ScenarioNode } from '../spec-tree/index.ts'
import { findSections, parseEntry, readMarkdown } from './format.ts'
import type { RequirementSection } from './format.ts'
import type { CapabilitySpec, RequirementSpec } from './types.ts'

/**
 * Reads one committed capability file: its requirements, the description written under
 * each, and the scenarios each records. It takes the file's text rather than its path —
 * opening files is `cli`'s job, and nothing here needs a filesystem.
 *
 * The capability's name comes from the caller, which knows the file it opened, rather than
 * from the file's own title. A title is prose the human owns, and making it load-bearing
 * would let a typo in a heading detach a whole capability from the tests that prove it.
 */
export function readCapabilityFile(source: string, options: { capability: string }): CapabilitySpec {
  const markdown = readMarkdown(source)
  const requirements = findSections(markdown)
    .map(section => toRequirementSpec(section, markdown.lines))
    .sort((a, b) => compareStrings(a.requirement, b.requirement))
  return { capability: options.capability, requirements }
}

function toRequirementSpec(section: RequirementSection, lines: readonly string[]): RequirementSpec {
  return {
    requirement: section.requirement,
    description: descriptionOf(section, lines),
    scenarios: recordedEntries(section, lines),
  }
}

/**
 * The prose between the heading and the generated block, with the blank lines around it
 * dropped. Where a section has no block, its description runs to the next heading.
 */
function descriptionOf(section: RequirementSection, lines: readonly string[]): string {
  const blockBegins = section.block.kind === 'present' ? section.block.replaced.from : section.endLine
  const prose = lines.slice(section.headingLine + 1, blockBegins)
  return prose.join('\n').trim()
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
