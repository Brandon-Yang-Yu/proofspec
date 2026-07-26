import { compareStrings } from '../order.ts'
import type { RequirementNode, ScenarioNode } from '../spec-tree/index.ts'
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  findSections,
  lastWrittenLine,
  readMarkdown,
  renderEntry,
  toSource,
} from './format.ts'
import type { LineRange, RequirementSection } from './format.ts'

/**
 * Records what the tests prove in a committed capability file, and changes nothing else.
 * Like the read above it, this takes the file's text and gives text back; writing it to
 * disk is `cli`'s job.
 *
 * The file's own requirements decide what is written: each declared requirement gets the
 * entries handed over for it, and a requirement nothing was handed for gets an empty
 * block. Entries for a requirement the file does not declare are left out, because the
 * heading and the description are the human's half of the file and a tool that authored
 * one would be writing the half it does not own. The guard reports those entries instead.
 */
export function updateScenarioBlocks(
  source: string,
  options: { requirements: readonly RequirementNode[] },
): string {
  const markdown = readMarkdown(source)
  const entriesByRequirement = new Map(
    options.requirements.map(node => [node.requirement, node.scenarios]),
  )

  const updated: string[] = []
  let copiedUpTo = 0
  for (const section of findSections(markdown)) {
    const entries = entriesByRequirement.get(section.requirement) ?? []
    const edit = blockEdit(section, markdown.lines, entries)
    updated.push(...markdown.lines.slice(copiedUpTo, edit.from), ...edit.lines)
    copiedUpTo = edit.to
  }
  updated.push(...markdown.lines.slice(copiedUpTo))
  return toSource(updated)
}

/** The lines `[from, to)` of one section give way to `lines`. Every other line is untouched. */
type BlockEdit = LineRange & {
  readonly lines: readonly string[]
}

function blockEdit(
  section: RequirementSection,
  lines: readonly string[],
  entries: readonly ScenarioNode[],
): BlockEdit {
  const block = renderBlock(entries)
  // A block with no closing marker replaces what it has and gets one back, so a file that
  // lost its marker comes to rest instead of gaining a block on every run.
  if (section.block.kind === 'present') return { ...section.block.replaced, lines: block }
  // A requirement written by hand has no block yet. It goes after the description, one
  // blank line down, and the blank lines that already ran up to the next heading stay
  // where they were.
  const afterDescription = lastWrittenLine(lines, section.headingLine, section.endLine) + 1
  return { from: afterDescription, to: afterDescription, lines: ['', ...block] }
}

/**
 * Entries in title order, sorted here rather than trusted to arrive that way. The file has
 * to come out identical on every machine, and that is a promise the writer can keep on its
 * own instead of one it makes about whoever called it.
 */
function renderBlock(entries: readonly ScenarioNode[]): string[] {
  const inTitleOrder = [...entries].sort((a, b) => compareStrings(a.scenario, b.scenario))
  return [BLOCK_OPEN, ...inTitleOrder.map(renderEntry), BLOCK_CLOSE]
}
