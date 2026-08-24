/**
 * What running a command produces, and what a run is given. `cli` is the one capability
 * that owns the filesystem and the process, so this is where a verdict finally becomes an
 * exit code — but not here in the type. `guard` returns a verdict rather than an exit code
 * (design.md §18), and `cli` keeps that boundary: the command produces an `Outcome`, and
 * turning it into a number a process exits with is `render`'s job.
 */

import type { GuardReport } from '../guard/index.ts'
import type { ImpactNode } from '../impact/index.ts'
import type { LineRange, TouchedScenario } from '../locate/index.ts'

/** Where a repo keeps its capability files and its tests, both as directories under the root. */
export type Locations = {
  readonly specsDir: string
  readonly testsDir: string
}

/**
 * What a command is asked to do. The locations are optional because the conventional layout
 * needs none: left out, they fall back to `specs/` and `tests/`, which is what lets the
 * check run in an ordinary repo with no configuration. `out` is the directory `render` writes
 * its pages into; left out, it falls back to `build/` at the repo root. It is a generated
 * output, so a project gitignores it rather than committing it.
 */
export type RunOptions = {
  readonly cwd: string
  readonly out?: string
  /** The revision `touched` and `impact` measure from; left out, where the branch left `main`. */
  readonly since?: string
  /** A call graph for `impact` to walk, instead of the one the indexer holds. */
  readonly graph?: string
  /** The indexed project `impact` reads its graph from; left out, derived from `cwd`. */
  readonly project?: string
  /** How far up the call chain `impact` walks. */
  readonly depth?: number
  /** What a test run recorded, narrowing `impact` from test files to scenarios. */
  readonly coverage?: string
} & Partial<Locations>

/** Where a requirement is written: the capability file, and the line of its heading. */
export type SpecLocation = {
  readonly file: string
  readonly line: number
}

/** A run of proving lines, as they are written. */
export type ProvingLines = LineRange & {
  readonly source: string
}

/**
 * A scenario a change touched, carrying what it takes to judge it: the claim it makes (passed
 * through from `locate` untouched), where the requirement it proves is written, and the proving
 * lines themselves. `locate` names those lines; `cli` owns the filesystem, so this is where they
 * become the text an agent reads without a second read of the file.
 */
export type TouchedScenarioReport = Omit<TouchedScenario, 'proves'> & {
  /** Absent when no capability file declares the requirement — a gap the check reports. */
  readonly spec: SpecLocation | undefined
  readonly proof: readonly ProvingLines[]
}

/** Changed lines that fall in no proof: a helper, an import, a fixture. */
export type UnmatchedLines = LineRange & {
  readonly file: string
}

/** A scenario the change stopped proving, read from the base revision. */
export type GoneScenario = {
  readonly capability: string
  readonly requirement: string
  readonly scenario: string
  /** The file that used to prove it. */
  readonly file: string
  readonly spec: SpecLocation | undefined
}

/**
 * What a change touched. It is a report, never a verdict: `gone` names a promise nothing
 * proves any more, but deciding whether that fails a build is the check's job, not this one's.
 */
export type TouchedReport = {
  /** The revision everything here was measured against. */
  readonly base: string
  readonly scenarios: readonly TouchedScenarioReport[]
  readonly unmatched: readonly UnmatchedLines[]
  readonly gone: readonly GoneScenario[]
}

/** One requirement a test file proves, and every scenario of it that file holds. */
export type ProvenRequirement = {
  readonly capability: string
  readonly requirement: string
  readonly spec: SpecLocation | undefined
  readonly scenarios: readonly string[]
}

/** What one test file on the impact tree proves. */
export type TestProves = {
  readonly file: string
  readonly requirements: readonly ProvenRequirement[]
}

/**
 * What a change to the source reaches: the changed functions with everything that calls
 * them, and what the tests hanging off that tree prove. The tests are the ones to review and
 * their requirements the ones to re-read, which is the whole reason to walk the graph.
 */
export type ImpactReport = {
  readonly base: string
  readonly changed: readonly ImpactNode[]
  /** Changed files holding no function the graph knows. */
  readonly unmapped: readonly string[]
  readonly proves: readonly TestProves[]
  /**
   * How `proves` was arrived at. The call graph says which test files *can* reach the
   * change; a test run says which scenarios *did*. A reader has to know which of the two is
   * on the page, because one is a superset kept deliberately wide and the other is exact.
   */
  readonly from: 'call-graph' | 'test-run'
}

/**
 * The result of a command, as a value. `cannot-run` is kept apart from a checked report on
 * purpose: CI has to tell "your spec has drifted" from "I could not read my inputs", and a
 * union says which happened without a caller having to infer it from an exit code.
 *
 * `wrote.files` names files the way each command anchors them: `write` reports repo-relative
 * paths because they are the committed entries' paths, while `render` keeps the spelling the
 * out directory was given — absolute in, absolute out — so the answer names the pages where
 * the caller will look for them.
 */
export type Outcome =
  | { readonly kind: 'checked'; readonly report: GuardReport }
  | { readonly kind: 'touched'; readonly report: TouchedReport }
  | { readonly kind: 'impact'; readonly report: ImpactReport }
  | { readonly kind: 'wrote'; readonly files: readonly string[] }
  | { readonly kind: 'cannot-run'; readonly reason: string }
