import type { Citation, JudgedPromise, ProposedReview, ProvingLines, Recorded, ReviewSubject } from './types.ts'

/**
 * A proposed review turned into the line the ledger keeps, or turned away.
 *
 * The asymmetry here is the point, not an oversight. A pass has to cite the line that proves
 * the claim and the citation is checked; a reported problem needs a sentence. That leaves
 * reporting a problem the cheapest answer a reviewer can give, which is the only thing that
 * keeps the answers honest — a gate that charges more for bad news gets less of it, and what
 * it then measures is the reviewer's willingness to let themselves through.
 *
 * What the citation buys is worth being exact about. It does not prove the reviewer read
 * anything: the proving source was handed to them, so any line of it is theirs to quote. It
 * forces them to commit to one claim-to-assertion correspondence — and the commonest real
 * drift, a claim promising something no line asserts, is the one you cannot point at.
 */
export function recordReview(review: {
  readonly proposed: ProposedReview
  readonly promise: JudgedPromise
}): Recorded {
  const { proposed, promise } = review
  const scenario = promise.scenario
  if (proposed.by === undefined || proposed.by.trim() === '') {
    return { ok: false, reason: 'a review has to name who made it' }
  }

  const subject: ReviewSubject = {
    key: proposed.key,
    capability: scenario.capability,
    requirement: scenario.requirement,
    scenario: scenario.scenario,
    by: proposed.by,
    at: proposed.at,
  }

  if (proposed.verdict !== 'ok') {
    const note = proposed.note
    // A bare verdict is a fact nobody can act on or check. Whoever picks the branch up reads
    // the note, and it is the whole of what the cheap answer buys them.
    if (note === undefined || note.trim() === '') {
      return { ok: false, reason: `a ${proposed.verdict} has to say what is wrong with the claim` }
    }
    return { ok: true, entry: { ...subject, verdict: proposed.verdict, note } }
  }

  // A removed proof is the one promise a pass cannot cite: the lines that proved it are gone.
  // Requiring a citation anyway made a pass unreachable, so a branch that deleted a proof could
  // not clear the gate — and an unclearable gate is what gets a reviewer writing whichever
  // verdict does go through instead of the one they reached.
  if (promise.kind === 'gone') {
    if (proposed.proves !== undefined) {
      return { ok: false, reason: 'a removed proof has no lines left to cite' }
    }
    return { ok: true, entry: { ...subject, verdict: 'ok', cites: undefined } }
  }

  const cited = citeLine({ line: proposed.proves, proof: promise.scenario.proof })
  if (!cited.ok) return cited
  return { ok: true, entry: { ...subject, verdict: 'ok', cites: cited.cites } }
}

/** The line a pass points at, read out of the proof, or why it is no citation at all. */
type Cited =
  | { readonly ok: true; readonly cites: Citation }
  | { readonly ok: false; readonly reason: string }

function citeLine(citation: {
  readonly line: number | undefined
  readonly proof: readonly ProvingLines[]
}): Cited {
  const { line, proof } = citation
  if (line === undefined) {
    return { ok: false, reason: 'a pass has to cite the line that proves the claim' }
  }

  const run = proof.find(owned => line >= owned.from && line <= owned.to)
  if (run === undefined) {
    return { ok: false, reason: `line ${line} is not among the lines that prove this scenario` }
  }

  // A run counts from its first line and includes both ends; `split` counts from zero.
  const source = run.source.split('\n')[line - run.from] ?? ''
  if (source.trim() === '') {
    return { ok: false, reason: `line ${line} is blank, so it asserts nothing` }
  }
  return { ok: true, cites: { line, source } }
}
