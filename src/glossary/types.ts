/**
 * The glossary's vocabulary and its semantics. `spec-file` reads Term sections out of the
 * committed files; this capability is everything past that — what counts as a use, what
 * counts as a change, and which promises a changed term re-opens.
 *
 * It reads no files and knows no format: it is handed terms and promises as values, the way
 * `guard` is handed scans and a committed tree. Where the definitions come from, and which
 * revision the "before" of a change is read from, are `cli`'s to decide.
 */

import type { Step } from '../test-scan/index.ts'
import type { TermSpec } from '../spec-file/index.ts'

/**
 * How one term moved between the base revision and the working tree. The three ways it can
 * move are the three arms: a definition that reads differently now, a word the base
 * revision did not define, and a word this one no longer does. There is no arm for "did not
 * move", because a term that did not move is not in the answer at all.
 */
export type TermChange =
  | { readonly kind: 'reworded'; readonly term: string; readonly before: string; readonly after: string }
  | { readonly kind: 'new'; readonly term: string; readonly after: string }
  | { readonly kind: 'gone'; readonly term: string; readonly before: string }

/**
 * The texts a promise is judged against: its requirement's heading and description, its own
 * title, and the steps it claims. The proof is not here — the proof is what the standard is
 * applied to, not part of the standard itself.
 */
export type PromiseStandard = {
  readonly capability: string
  readonly requirement: string
  readonly scenario: string
  readonly description: string | undefined
  readonly claim: readonly Step[]
}

/** A promise a changed term reached, carrying the changes that reached it. */
export type ReopenedPromise = PromiseStandard & {
  readonly reopenedBy: readonly TermChange[]
}
