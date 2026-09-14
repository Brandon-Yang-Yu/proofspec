/**
 * What running a command produces, and what a run is given. `cli` is the one capability
 * that owns the filesystem and the process, so this is where a verdict finally becomes an
 * exit code — but not here in the type. `guard` returns a verdict rather than an exit code
 * (design.md §18), and `cli` keeps that boundary: the command produces an `Outcome`, and
 * turning it into a number a process exits with is `render`'s job.
 */

import type { GuardReport } from '../guard/index.ts'
import type { Graph } from '../dispatch/index.ts'
import type { TermChange } from '../glossary/index.ts'
import type { ImpactNode } from '../impact/index.ts'
import type { LineRange, TouchedScenario } from '../locate/index.ts'
import type { ProvingLines, ReviewEntry, ReviewProtocol } from '../review/index.ts'
import type { RaisedEntry, ScheduleActions, SchedulePlan } from '../schedule/index.ts'
import type { SourceFile } from './discover.ts'

/** Where a repo keeps its capability files and its tests, both as directories under the root. */
export type Locations = {
  readonly specsDir: string
  readonly testsDir: string
}

/**
 * Tests a caller has already read, standing in for discovery. A repo whose tests live where
 * the conventional walk cannot reach them — several roots, another suffix — reads them its
 * own way and hands them over. The roots are given with the files because the diff needs a
 * place to look: a test file the branch deleted is not among the files, and its removal is
 * only visible when the diff is scoped to where tests live.
 */
export type GivenTests = {
  /** Where the tests live, as git pathspecs: the diff scope `touched` measures. */
  readonly roots: readonly string[]
  readonly files: readonly SourceFile[]
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
  /** Which of its three answers `touched` is asked for; left out, the work list. */
  readonly ask?: TouchedAsk
  /** The review `review` is asked to record. */
  readonly review?: ProposedInput
  /** A human's ruling `schedule` is asked to record, instead of running a scheduling pass. */
  readonly ruling?: ProposedRuling
  /** The external actions a scheduling pass hands off: starting a session, judging a relationship,
   *  notifying a human. Only required when a pass actually needs one of them. */
  readonly schedule?: ScheduleActions
  /** What a scheduling pass treats as "now", for a LEASE's elapsed time; left out, the real clock. */
  readonly now?: Date
  /** Tests read by the caller, instead of discovering them under `testsDir`. */
  readonly tests?: GivenTests
} & Partial<Locations>

/** A human's ruling on one relationship `schedule` already raised, as the command line gives it. */
export type ProposedRuling = {
  readonly key: string
  readonly ruling: string
}

/** Where a requirement is written: the capability file, and the line of its heading. */
export type SpecLocation = {
  readonly file: string
  readonly line: number
}

/** A judgement standing against a promise, as the report shows it. */
export type StandingReview = {
  readonly verdict: ReviewEntry['verdict']
  readonly by: string
  readonly at: string
}

/**
 * A scenario a change touched, carrying what it takes to judge it: the claim it makes (passed
 * through from `locate` untouched) and the proving lines themselves. `locate` names those
 * lines; `cli` owns the filesystem, so this is where they become the text an agent reads
 * without a second read of the file.
 *
 * Which requirement it proves is not on it. The report groups scenarios under the requirement
 * they prove, so the capability, the requirement and where it is written are read from the
 * one entry above them rather than copied onto every scenario under it.
 */
/**
 * What reached a promise, as the report says it. Five states rather than flags: a
 * change to the test, a redefined term, a reworded description, or either of the last
 * two beside a change to the test — because a branch can move a test line and a
 * definition or a description in one change, and that is still one promise, settled by
 * one judgement.
 */
export type ScenarioReach =
  | { readonly changed: TouchedScenario['changed']; readonly reopenedBy?: undefined }
  | { readonly changed: 'term' | 'description'; readonly reopenedBy: readonly StandardChange[] }
  | { readonly changed: TouchedScenario['changed']; readonly reopenedBy: readonly StandardChange[] }

/** What re-opened a promise from the spec side: a moved meaning, or a moved standard. */
export type StandardChange = TermChange | DescriptionChange

/**
 * How one requirement's description moved between the base revision and the working tree.
 * The two ways it can move are the two arms: prose that reads differently now, and a
 * requirement the base revision did not hold — whose scenarios have fresh keys and no
 * judgements, so entering the work list is the honest state, symmetric with a new TERM
 * re-opening its users. There is no arm for a requirement the working tree dropped: its
 * proofs are gone and the check reports that, which is a different question from judging
 * a standing promise.
 */
export type DescriptionChange =
  | {
      readonly kind: 'description-reworded'
      readonly capability: string
      readonly requirement: string
      readonly before: string
      readonly after: string
    }
  | {
      readonly kind: 'description-new'
      readonly capability: string
      readonly requirement: string
      readonly after: string
    }

export type TouchedScenarioReport = Omit<TouchedScenario, 'proves' | 'capability' | 'requirement' | 'changed'> & {
  /** The key a judgement of it is filed under — what `review` is given to record against. */
  readonly key: string
  readonly proof: readonly ProvingLines[]
  /** The judgement standing against it, or nothing when none does. */
  readonly reviewed: StandingReview | undefined
} & ScenarioReach

/** `Omit` as a distributing operation: a union of shapes stays a union, key by key. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Where a requirement is written and what it says there. The two are read together or not at all. */
export type RequirementDeclaration = SpecLocation & {
  /** The prose between the heading and the generated block, as written. */
  readonly description: string
}

/**
 * A requirement this change reached, with everything it reached under it: the scenarios whose
 * proofs moved, and the proofs it removed outright.
 *
 * The report is grouped this way rather than kept as one flat list because a claim is judged
 * against the requirement it serves, and this puts that standard beside every claim under it —
 * once, whether the change touched one scenario of it or twenty. The terminal form still reads
 * as one file-ordered list, which is how a person walks a diff.
 *
 * It is also the unit a reviewer is handed, which is why the protocol comes with it: one
 * requirement is one sitting of work, judged against one standard, under one set of
 * instructions.
 */
export type TouchedRequirement = {
  readonly kind: 'requirement'
  readonly base: string
  /** The address it was asked for by. */
  readonly key: string
  readonly capability: string
  readonly requirement: string
  /** Absent when no capability file declares it — a gap the check reports. */
  readonly spec: RequirementDeclaration | undefined
  /** Its scenarios the change touched, in file order. */
  readonly scenarios: readonly TouchedScenarioReport[]
  /** Its proofs the change removed, in title order. */
  readonly gone: readonly GoneScenario[]
  /** How the scenarios above are to be judged, delivered rather than remembered. */
  readonly review: ReviewProtocol
}

/**
 * One requirement as the work list counts it. Three numbers rather than its contents: the
 * summary is what a reviewer reads to decide what to fetch, and a list that carried the claims
 * would be the whole report again — which is the thing this shape exists to stop being.
 */
export type ReachedRequirement = {
  /** The address its scenarios are fetched by. */
  readonly key: string
  readonly capability: string
  readonly requirement: string
  /** How many of its scenarios the change touched. */
  readonly scenarios: number
  /** How many of its proofs the change removed. */
  readonly gone: number
  /** How many of those promises no judgement stands against. */
  readonly pending: number
}

/**
 * Changed lines that fall in no proof: a helper, an import, a fixture. They carry their source
 * for the reason a touched scenario carries its proof — the tool is holding the lines, and the
 * reader would otherwise open the file to see an edit that is usually two lines long.
 */
export type UnmatchedLines = LineRange & {
  readonly file: string
  readonly source: string
}

/**
 * A scenario the change stopped proving, read from the base revision. Like a touched scenario
 * it is named under the requirement it used to prove, so it carries only what is its own.
 */
export type GoneScenario = {
  /** The key a judgement of it is filed under. Its name alone: nothing of it is left to weigh. */
  readonly key: string
  readonly scenario: string
  /** The file that used to prove it. */
  readonly file: string
  readonly reviewed: StandingReview | undefined
}

/**
 * The work list: which requirements the change reached and how much of each is still unjudged.
 * This is the answer `touched` gives when it is not asked for anything in particular, and it
 * is the only one that holds the gate.
 */
export type TouchedSummary = {
  readonly kind: 'summary'
  /** The revision everything here was measured against. */
  readonly base: string
  /** What the change reached, in capability then requirement order. */
  readonly requirements: readonly ReachedRequirement[]
  /** How many runs of changed lines fall in no proof. They are asked for on their own. */
  readonly unmatched: number
}

/**
 * The changed lines no promise owns — a helper, an import, a fixture. Asked for on their own
 * rather than carried in the work list, because they are not work: nothing judges them, and on
 * a real branch there are more of them than there are promises.
 */
export type TouchedUnmatched = {
  readonly kind: 'unmatched'
  readonly base: string
  readonly lines: readonly UnmatchedLines[]
}

/**
 * What a change touched, in the shape it was asked for.
 *
 * Three answers rather than one, because the report has two readers with opposite costs. The
 * summary is what a reviewer reads to decide what to do next, and it has to be small enough to
 * read on every run; a requirement is one sitting of work, and it has to carry everything that
 * sitting needs. Handing over both at once — which is what one shape meant — made every run
 * cost the whole branch.
 *
 * On what it judges: naming a promise, even one nothing proves any more, is still a report and
 * not a verdict. What the summary does judge is whether every promise the change reached has
 * been *looked at*, which is a fact about the reviewing rather than about the code.
 */
export type TouchedReport = TouchedSummary | TouchedRequirement | TouchedUnmatched

/**
 * Which of the three answers `touched` is being asked for. A union rather than a flag pile, so
 * a caller cannot ask for a requirement and the unmatched lines at once and leave the command
 * to decide which it meant.
 */
export type TouchedAsk =
  | { readonly kind: 'summary' }
  | { readonly kind: 'requirement'; readonly key: string }
  | { readonly kind: 'unmatched' }

/**
 * A review as the command line gives it, before `review` turns it into an entry or turns it
 * away. There is no `at`: the clock is a boundary, and `cli` owns the boundaries.
 */
export type ProposedInput = {
  readonly key: string
  /** As typed, not yet known to name a verdict: `review` is what refuses one that does not. */
  readonly verdict: string
  readonly proves: number | undefined
  readonly note: string | undefined
  readonly by: string | undefined
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
  | { readonly kind: 'reviewed'; readonly entry: ReviewEntry }
  | { readonly kind: 'impact'; readonly report: ImpactReport }
  | { readonly kind: 'wrote'; readonly files: readonly string[] }
  | { readonly kind: 'dispatch'; readonly report: Graph }
  | { readonly kind: 'scheduled'; readonly report: SchedulePlan }
  | { readonly kind: 'ruled'; readonly entry: Extract<RaisedEntry, { readonly kind: 'ruled' }> }
  | { readonly kind: 'cannot-run'; readonly reason: string }
