/**
 * What a review is, and what `review` needs in hand to judge one.
 *
 * This capability reads no files. `cli` owns the ledger on disk and assembles the touched
 * report; what a line of that ledger means, what key a judgement is filed under, and whether
 * a change has been judged through are this capability's — the way the shape of a capability
 * file is `spec-file`'s and writing it is `cli`'s.
 */

import type { LineRange } from '../locate/index.ts'
import type { ScenarioIdentity } from '../spec-tree/index.ts'
import type { TermSpec } from '../spec-file/index.ts'
import type { Step } from '../test-scan/index.ts'

/**
 * What a reviewer concluded. `gap` and `drift` are kept apart because they send a reader to
 * different places: a gap is a proof that does not assert what its claim promises, and drift
 * is the two describing different things. One is a test to extend, the other a sentence to
 * rewrite, and a single "not ok" would leave the reader to work out which.
 */
export type Verdict = 'ok' | 'gap' | 'drift'

/**
 * The line a pass points at, carried as it is written. The number alone says nothing to
 * whoever reads the ledger in a diff; the source is what lets them see at a glance that the
 * reviewer pointed at an assertion rather than at an import.
 */
export type Citation = {
  readonly line: number
  readonly source: string
}

/**
 * What was concluded and what backs it. A pass cites the line that proves the claim; a
 * reported problem carries a note. A union rather than two optional fields, because exactly
 * one of them is present and the verdict is what decides which.
 *
 * `recordReview` is the only thing that should build one. The `ok` arm carries a second rule
 * the type does not state — a citation is required of a touched scenario and forbidden of a
 * removed proof — and that rule lives there. A fixture that assembles one by hand is fine;
 * production code that does is a second place for the rule to be got wrong.
 */
export type Judgement =
  /**
   * A pass, and the line it points at. `cites` is nothing only for a proof the change removed:
   * there is no line left to point at, and requiring one there would make a pass unreachable.
   */
  | { readonly verdict: 'ok'; readonly cites: Citation | undefined }
  | { readonly verdict: 'gap' | 'drift'; readonly note: string }

/**
 * What a review is about. A union rather than a scenario with its claim and proof left empty,
 * because "there is nothing to cite" has to be something the caller says rather than something
 * inferred from an absence — the two are indistinguishable, and reading one as the other is
 * what made a pass on a removed proof impossible to record.
 */
export type JudgedPromise =
  | { readonly kind: 'touched'; readonly scenario: JudgedScenario }
  | { readonly kind: 'gone'; readonly scenario: GoneProof }

/** What a review is about and who made it — the half every verdict carries alike. */
export type ReviewSubject = {
  /** The digest of what was judged. A different claim, proof or standard is a different key. */
  readonly key: string
  readonly capability: string
  readonly requirement: string
  readonly scenario: string
  /** Who judged it. An unsigned judgement is one nobody can be asked about, so it is required. */
  readonly by: string
  /** When, as an ISO instant. For the person reading the ledger in a diff, not for the tool. */
  readonly at: string
}

/** One line of the ledger: a judgement, what it judged, and who made it. */
export type ReviewEntry = ReviewSubject & Judgement

/** A run of proving lines, as they are written. `locate` owns the run; this adds the source. */
export type ProvingLines = LineRange & {
  readonly source: string
}

/**
 * What `review` needs to know about one scenario a change touched. Its own type rather than
 * the report `cli` assembles, so this capability never learns what a command's answer looks
 * like — `cli` maps into it, the way it maps into every other library capability.
 */
export type JudgedScenario = ScenarioIdentity & {
  /** The requirement's prose, or nothing when no capability file declares it. */
  readonly description: string | undefined
  readonly claim: readonly Step[]
  readonly proof: readonly ProvingLines[]
  /** The definitions of the terms this promise's standard uses, directly or through another
   * term's definition, in term order. Empty when the standard uses none — which is why a
   * repository with no glossary keys exactly as it always did. */
  readonly definitions: readonly TermSpec[]
}

/** A promise the change stopped proving. Nothing of it is left to judge but its name. */
export type GoneProof = ScenarioIdentity

/**
 * A promise a change reached that no judgement stands against. `kind` says which question it
 * asks: a touched scenario asks whether its claim still reads its proof honestly, a gone one
 * asks whether the promise was meant to die.
 */
export type PendingPromise = ScenarioIdentity & {
  readonly key: string
  readonly kind: 'touched' | 'gone'
}

/** A ledger read back, or the line that could not be read. */
export type LedgerRead =
  | { readonly ok: true; readonly entries: readonly ReviewEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * A review as it arrives from a command line, before anything has been checked. This is the
 * one place the fields are optional: it is the boundary where loose input becomes a
 * `Judgement`, and turning it away is what `recordReview` exists to do.
 */
export type ProposedReview = {
  readonly key: string
  readonly verdict: Verdict
  readonly proves: number | undefined
  readonly note: string | undefined
  readonly by: string | undefined
  readonly at: string
}

/** A review accepted into the ledger, or why it was turned away. */
export type Recorded =
  | { readonly ok: true; readonly entry: ReviewEntry }
  | { readonly ok: false; readonly reason: string }

/**
 * How the scenarios under a requirement are to be judged, handed over with them. The wording
 * is the tool's rather than the caller's for the same reason the payload is: a reviewer asked
 * "is this claim honest?" answers yes, and one asked to find the overstatement goes looking.
 */
export type ReviewProtocol = {
  readonly judge: string
  readonly pass: string
  readonly report: string
}
