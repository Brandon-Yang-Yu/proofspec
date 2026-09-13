/**
 * What the guard found, and whether the build can go on. This is the whole contract
 * between `guard` and the CLI: the CLI chooses an output format, and the wording of each
 * diagnostic is decided here.
 */

import type { Placement, ScenarioIdentity } from '../spec-tree/index.ts'
import type { TermSpec } from '../spec-file/index.ts'
import type { ScanErrorKind } from '../test-scan/index.ts'

/** A term as the guard receives it: the definition, plus the CAPABILITY_FILE it was written in. */
export type TermDeclaration = TermSpec & { readonly capability: string }

/**
 * One thing the guard has to say. Every kind carries where to look, because a diagnostic
 * that omits the location hands the reader the whole search back.
 */
export type Finding =
  /** The tests prove a scenario the capability file does not record, at this site. */
  | (ScenarioIdentity & { readonly kind: 'scenario-added'; readonly file: string; readonly line: number })
  /** The capability file records a scenario no test proves. It has no site left to name. */
  | (ScenarioIdentity & { readonly kind: 'scenario-removed'; readonly file: string })
  /** The scenario is proven in a file other than the one recorded, at this line of it. */
  | (ScenarioIdentity & {
      readonly kind: 'scenario-moved'
      readonly from: string
      readonly to: string
      readonly line: number
    })
  /** A tag names a requirement its capability file does not declare. */
  | (ScenarioIdentity & { readonly kind: 'unknown-requirement'; readonly file: string; readonly line: number })
  /** A declared requirement that no test tags. It has no site, so it carries no location. */
  | { readonly kind: 'uncovered-requirement'; readonly capability: string; readonly requirement: string }
  /**
   * A committed capability file declares the same requirement twice. The fault is in the
   * file, not at any proof site, so it names the capability and the requirement and no more.
   */
  | { readonly kind: 'duplicate-requirement'; readonly capability: string; readonly requirement: string }
  /** One scenario claimed at more than one proof site, naming every site that claimed it. */
  | (ScenarioIdentity & { readonly kind: 'duplicate-scenario'; readonly sites: readonly Placement[] })
  /** A tagged site in a file that declares no capability, so the tree has nowhere to put it. */
  | {
      readonly kind: 'no-capability'
      readonly requirement: string
      readonly scenario: string
      readonly file: string
      readonly line: number
    }
  /**
   * A tagged site with no GIVEN, WHEN or THEN above it: a finding that warns rather than
   * fails. It names the site rather than the capability, because a site the tree could not
   * place has no capability and is warned about all the same.
   */
  | {
      readonly kind: 'no-steps'
      readonly requirement: string
      readonly scenario: string
      readonly file: string
      readonly line: number
    }
  /** Something the scan could not read, carried through with what the scan said about it. */
  | {
      readonly kind: 'unreadable'
      readonly reason: ScanErrorKind
      readonly message: string
      readonly file: string
      readonly line: number
    }
  /** A Term section whose definition holds a promise. The fault is in the vocabulary, so it names the term. */
  | { readonly kind: 'term-promises'; readonly term: string }
  /** A term named in other than capitals: the match key no requirement can ever use. */
  | { readonly kind: 'term-not-in-capitals'; readonly term: string }
  /** Two Term sections defining one word, leaving "the definition" not existing. */
  | { readonly kind: 'term-defined-twice'; readonly term: string }
  /** A Term section found outside the glossary: the vocabulary is written in one place. */
  | { readonly kind: 'term-outside-glossary'; readonly term: string; readonly capability: string }
  /**
   * A definition that spells another defined TERM in its everyday form — `claim` where CLAIM
   * is defined. It warns rather than fails: the reviewer reading the definition's then and
   * now is the backstop, and the warning is where the lost edge becomes visible. `term` is
   * the TERM whose definition is at fault; `near` is the TERM it spelled everyday.
   */
  | { readonly kind: 'term-near-form'; readonly term: string; readonly near: string }

export type FindingSeverity = 'fail' | 'warn'

export type GuardReport = {
  /**
   * Whether the build can go on. `fail` when any finding is a failure; warnings on their
   * own pass. The verdict, not an exit code — turning it into a number is the CLI's job,
   * and a process concern has no business in the type the rules produce.
   */
  readonly status: 'pass' | 'fail'
  /** In a fixed order, so two runs over the same tests report the same thing. */
  readonly findings: readonly Finding[]
}
