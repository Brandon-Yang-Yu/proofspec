// Capability: review

import { expect, it } from 'vitest'
import { recordReview } from '../../src/review/index.ts'
import type { ProposedReview, Verdict } from '../../src/review/index.ts'
import { gone, judged } from './support.ts'

/** A review as it arrives from a command line, with a default for every field. */
function proposed(fields: {
  readonly verdict?: Verdict
  readonly proves?: number | undefined
  readonly note?: string | undefined
  readonly by?: string | undefined
} = {}): ProposedReview {
  return {
    key: 'a3f9c1d2b4e5',
    verdict: fields.verdict ?? 'ok',
    proves: 'proves' in fields ? fields.proves : 20,
    note: 'note' in fields ? fields.note : undefined,
    by: 'by' in fields ? fields.by : 'a reviewer',
    at: '2026-08-24T00:00:00.000Z',
  }
}

/**
 * A proof written over three lines, so the line a citation names has to be cut out of the run
 * rather than taken whole. A run counts from 1 and includes both ends, and getting that
 * arithmetic wrong points a reader at the line beside the one the reviewer meant.
 */
const OVER_THREE_LINES = [{ from: 20, to: 22, source: 'const outcome = act()\n\nexpect(outcome).toBe(true)' }]

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass citing a proving line carries that line as it is written
// GIVEN a scenario proven over lines 20 to 22, whose last line asserts the CLAIM
// WHEN a pass is recorded citing line 22
// THEN the entry carries that line as it is written, because the number alone tells whoever
//      reads the LEDGER in a diff nothing about what the reviewer pointed at
it('carries the cited line as it is written', () => {
  const recorded = recordReview({
    proposed: proposed({ proves: 22 }),
    promise: { kind: 'touched', scenario: judged({ proof: OVER_THREE_LINES }) },
  })

  expect(recorded).toEqual({
    ok: true,
    entry: expect.objectContaining({
      verdict: 'ok',
      cites: { line: 22, source: 'expect(outcome).toBe(true)' },
    }),
  })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass citing a line outside the proving lines is refused
// GIVEN a scenario whose proving lines run from 20 to 22
// WHEN a pass is recorded citing line 30
// THEN it is refused, because a line the PROOF does not own says nothing about this CLAIM,
//      and a citation nobody checked is a signature rather than a review
it('refuses a pass citing a line the proof does not own', () => {
  const recorded = recordReview({
    proposed: proposed({ proves: 30 }),
    promise: { kind: 'touched', scenario: judged({ proof: OVER_THREE_LINES }) },
  })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('not among the lines that prove') })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass citing a blank line is refused
// GIVEN a scenario proven over lines 20 to 22, whose middle line is blank
// WHEN a pass is recorded citing line 21
// THEN it is refused, because a blank line asserts nothing, and it is the line a citation
//      lands on when a number was picked rather than read
it('refuses a pass citing a blank line', () => {
  const recorded = recordReview({
    proposed: proposed({ proves: 21 }),
    promise: { kind: 'touched', scenario: judged({ proof: OVER_THREE_LINES }) },
  })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('blank') })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass citing no line at all is refused
// GIVEN a pass with no line cited
// WHEN it is recorded
// THEN it is refused, because a bare pass is what a reviewer writes without reading, and
//      making the pass the expensive answer is what leaves reporting a problem the cheap one
it('refuses a pass that cites nothing', () => {
  const recorded = recordReview({ proposed: proposed({ proves: undefined }), promise: { kind: 'touched', scenario: judged() } })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('has to cite the line') })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A reported problem is recorded with its note and no citation
// GIVEN a reviewer who found the CLAIM promising more than its PROOF asserts
// WHEN a gap is recorded with a note and no line cited
// THEN it is accepted carrying the note, because reporting a problem has to stay the cheapest
//      answer available: a reviewer charged for honesty will stop being honest
it('accepts a reported problem carrying its note alone', () => {
  const recorded = recordReview({
    proposed: proposed({ verdict: 'gap', note: 'the THEN promises an order the test never asserts', proves: undefined }),
    promise: { kind: 'touched', scenario: judged() },
  })

  expect(recorded).toEqual({
    ok: true,
    entry: expect.objectContaining({
      verdict: 'gap',
      note: 'the THEN promises an order the test never asserts',
    }),
  })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A reported problem with no note is refused
// GIVEN a drift reported with no note
// WHEN it is recorded
// THEN it is refused, because "something is wrong here" read by whoever picks the branch up
//      later is a fact they cannot act on and cannot check
it('refuses a reported problem that says nothing', () => {
  const recorded = recordReview({
    proposed: proposed({ verdict: 'drift', note: undefined, proves: undefined }),
    promise: { kind: 'touched', scenario: judged() },
  })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('has to say what is wrong') })
})

// Requirement: Every review names who made it
// Scenario: A review naming no reviewer is refused
// GIVEN a pass that would otherwise be accepted, with nobody named as its reviewer
// WHEN it is recorded
// THEN it is refused, because an unsigned judgement is one nobody can be asked about, and
//      whether the reviewer was the author is the first thing a reader of the LEDGER asks
it('refuses a review nobody signed', () => {
  const recorded = recordReview({ proposed: proposed({ by: undefined }), promise: { kind: 'touched', scenario: judged() } })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('name who made it') })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass on a removed PROOF cites nothing
// GIVEN a PROOF the change removed, which a reviewer judges was meant to die
// WHEN a pass is recorded with no line cited
// THEN it is accepted, because nothing of a removed PROOF is left to point at — and a pass
//      that could not be recorded would leave a branch that deleted a PROOF unable to clear
//      the gate at all, which is the state that gets whoever hits it writing whichever verdict
//      does go through rather than the one they reached
it('accepts a pass on a removed proof, which has nothing left to cite', () => {
  const recorded = recordReview({
    proposed: proposed({ proves: undefined }),
    promise: { kind: 'gone', scenario: gone() },
  })

  expect(recorded).toEqual({
    ok: true,
    entry: expect.objectContaining({ verdict: 'ok', cites: undefined }),
  })
})

// Requirement: Passing a scenario means citing the line that proves it
// Scenario: A pass on a removed PROOF that cites a line is refused
// GIVEN a PROOF the change removed, and a pass offering a line as its citation
// WHEN it is recorded
// THEN it is refused, because the lines that proved it are gone, so whatever the citation
//      names is not among them and saying so is better than filing a pointer to nothing
it('refuses a pass on a removed proof that points at a line', () => {
  const recorded = recordReview({
    proposed: proposed({ proves: 20 }),
    promise: { kind: 'gone', scenario: gone() },
  })

  expect(recorded).toEqual({ ok: false, reason: expect.stringContaining('no lines left to cite') })
})
