/**
 * The stable tree and its diff. This is the whole contract between `spec-tree` and its
 * readers (`guard`, the capability-file write-back): they build no tree of their own, so
 * this shape is the one place the stable-identity rule lands.
 *
 * A scenario's identity is `(capability, requirement, scenario)` — the title, never the
 * line or the Gherkin steps. Those are stripped so a line shift or a reworded step never
 * reads as a change to the spec.
 */

import type { ProofSite } from '../test-scan/index.ts'

export type ScenarioNode = {
  /** The scenario title. */
  readonly scenario: string
  /** The file that proves it. No line: the tree holds location, not position. */
  readonly file: string
}

export type RequirementNode = {
  readonly requirement: string
  /** In title order. */
  readonly scenarios: readonly ScenarioNode[]
}

export type CapabilityNode = {
  readonly capability: string
  /** In requirement-name order. */
  readonly requirements: readonly RequirementNode[]
}

export type SpecTree = {
  /** In capability-name order. */
  readonly capabilities: readonly CapabilityNode[]
}

/**
 * What identifies a scenario in the tree: the title, under its requirement, under its
 * capability — never the line or the Gherkin steps. Named once and composed into the
 * shapes below so the identity is defined in exactly one place.
 */
export type ScenarioIdentity = {
  readonly capability: string
  readonly requirement: string
  readonly scenario: string
}

/** Where one proof site sits, kept on a collision so `guard` can point at it. */
export type Placement = {
  readonly file: string
  readonly line: number
}

/**
 * One identity proven at more than one proof site — the bijection broken. The tree keeps
 * the scenario once; this names every site that claimed it, so the author can see the
 * collision instead of it being silently deduplicated.
 */
export type Collision = ScenarioIdentity & {
  /** Every site that claimed the identity, in file then line order. */
  readonly sites: readonly Placement[]
}

export type TreeBuild = {
  readonly tree: SpecTree
  readonly collisions: readonly Collision[]
  /** Proof sites with no capability: they belong under none, so they are set aside here. */
  readonly unplaced: readonly ProofSite[]
}

/**
 * One difference between two trees. A rename is not a kind of its own: the title is the
 * identity, so a changed title reads as one `removed` and one `added`.
 */
export type TreeChange =
  | (ScenarioIdentity & { readonly kind: 'added'; readonly file: string })
  | (ScenarioIdentity & { readonly kind: 'removed'; readonly file: string })
  | (ScenarioIdentity & { readonly kind: 'moved'; readonly from: string; readonly to: string })

export type TreeDiff = {
  readonly changes: readonly TreeChange[]
}
