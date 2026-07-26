/**
 * What a committed capability file holds. This is the whole contract between `spec-file`
 * and its readers: nothing past this file learns that the format is Markdown.
 *
 * A requirement's two halves have different owners. The description is written by a
 * person; the scenario entries are written by the tool from the tests. Keeping them apart
 * is what this capability is for.
 */

import type { CapabilityNode, RequirementNode } from '../spec-tree/index.ts'

/** A requirement of the tree, plus the prose only the file holds. */
export type RequirementSpec = RequirementNode & {
  /** The prose between the heading and the generated block, as written. */
  readonly description: string
}

/**
 * One capability file, read. It is built on `CapabilityNode` rather than restated, so a
 * file that was read *is* a branch of the tree the guard compares against and cannot drift
 * away from that shape without the compiler saying so. Requirements come in name order and
 * their entries in title order, which is the order the tree holds them in, so nothing
 * downstream sorts them a second time.
 */
export type CapabilitySpec = Omit<CapabilityNode, 'requirements'> & {
  readonly requirements: readonly RequirementSpec[]
}
