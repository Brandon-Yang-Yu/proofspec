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
