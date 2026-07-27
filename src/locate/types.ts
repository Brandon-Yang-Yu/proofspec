/**
 * What locate delivers. This is the delivery half of the storage/delivery split
 * (`docs/design.md` §4): a scenario's position moves on every edit, so it is computed on
 * demand here and never written to the committed files.
 */

import type { ScenarioIdentity } from '../spec-tree/index.ts'

/**
 * Where a scenario is now, or that no tagged test carries it. A discriminated union rather
 * than a nullable position, so the caller has to branch — and the missing answer names what
 * it looked for instead of handing back a near match, which is what would send a reader to
 * the wrong test.
 */
export type Location =
  | { readonly kind: 'found'; readonly file: string; readonly line: number }
  | { readonly kind: 'missing'; readonly identity: ScenarioIdentity }

/** A scenario as the tree carries it (`ScenarioNode`) plus its current line. */
export type PositionedScenario = {
  readonly scenario: string
  readonly file: string
  readonly line: number
}

export type PositionedRequirement = {
  readonly requirement: string
  readonly scenarios: readonly PositionedScenario[]
}

export type PositionedCapability = {
  readonly capability: string
  readonly requirements: readonly PositionedRequirement[]
}

/** The whole tree, every scenario carrying its current file and line. */
export type PositionedTree = {
  readonly capabilities: readonly PositionedCapability[]
}
