/**
 * What locate delivers. This is the delivery half of the storage/delivery split
 * (docs/design.md, "Storage vs delivery"): a scenario's position moves on every edit, so it is computed on
 * demand here and never written to the committed files.
 */

import type { ScenarioIdentity } from '../spec-tree/index.ts'
import type { Step } from '../test-scan/index.ts'

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

/** A run of 1-based lines in a file, both ends inclusive. */
export type LineRange = {
  readonly from: number
  readonly to: number
}

/**
 * A scenario a change reached, and which of its two halves the change moved. A change to the
 * Gherkin rewrites the promise, a change below it rewrites the proof, and a reader reviewing a
 * diff has to tell those apart.
 *
 * `both` is an answer of its own rather than two flags to read together: an author who moved
 * the promise and the evidence at once is a different case from one who moved the test and
 * left the promise above it saying what the test no longer does.
 */
export type TouchedScenario = {
  readonly capability: string
  readonly requirement: string
  readonly scenario: string
  readonly file: string
  /** Where this site opens: its own tag block, not the prelude it may share with siblings. */
  readonly from: number
  readonly to: number
  readonly changed: 'claim' | 'proof' | 'both'
  /**
   * The claim in full: every step of the Gherkin, the ones written above the test and shared
   * with its siblings included. Delivered rather than pointed at, because the question this
   * report exists to raise — does the test still do what its claim says — cannot be asked
   * without the sentence in hand.
   */
  readonly claim: readonly Step[]
  /**
   * The lines that prove it. More than one run when the scenario is proven inside a shared
   * test: the setup that test shares, and the site's own statements, with its siblings' lines
   * in between belonging to them. Lines rather than source, because `locate` reads no files.
   */
  readonly proves: readonly LineRange[]
}

/** What a set of changed lines touched: the scenarios, and the lines that proved nothing. */
export type TouchedScenarios = {
  readonly scenarios: readonly TouchedScenario[]
  readonly unmatched: readonly LineRange[]
}
