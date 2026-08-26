// Capability: review

import { expect, it } from 'vitest'
import { goneKey, pendingPromises, scenarioKey } from '../../src/review/index.ts'
import { SCENARIO, claim, entry, gone, judged } from './support.ts'

/** Nothing has been reviewed and nothing was removed, unless a test says otherwise. */
const NOTHING_GONE: readonly ReturnType<typeof gone>[] = []

// Requirement: A change is unsettled until every PROMISE it reached has been judged
// Scenario: A scenario with no review under its KEY is pending
// GIVEN a scenario this change touched, and an empty LEDGER
// WHEN what is still pending is asked for
// THEN it is named, because the gate's whole question is whether anything reached by this
//      change has gone unlooked-at
it('names a touched scenario nobody has judged', () => {
  const scenario = judged()

  expect(pendingPromises({ scenarios: [scenario], gone: NOTHING_GONE, entries: [] })).toEqual([
    { key: scenarioKey(scenario), capability: 'demo', requirement: 'A demonstrated promise', scenario: SCENARIO, kind: 'touched' },
  ])
})

// Requirement: A change is unsettled until every PROMISE it reached has been judged
// Scenario: A scenario reviewed under an older KEY is pending again
// GIVEN a scenario passed once, whose CLAIM was then reworded
// WHEN what is still pending is asked for
// THEN it is named again, because the judgement standing in the LEDGER was made about a
//      PROMISE that is no longer the one written there — and nothing has to work out that
//      the review went stale, since the reworded CLAIM simply is not the KEY it was filed under
it('names again a scenario whose claim moved out from under its review', () => {
  const before = judged()
  const after = judged({ claim: claim('the demonstrated claim holds in every case') })
  const judgedBefore = entry({ key: scenarioKey(before) })

  const pending = pendingPromises({ scenarios: [after], gone: NOTHING_GONE, entries: [judgedBefore] })

  expect(pending).toEqual([expect.objectContaining({ key: scenarioKey(after), kind: 'touched' })])
})

// Requirement: A change is unsettled until every PROMISE it reached has been judged
// Scenario: A removed PROOF with no review is pending
// GIVEN a change that left a PROMISE with nothing proving it, and an empty LEDGER
// WHEN what is still pending is asked for
// THEN the removed PROOF is named, and named as removed, because it asks a different question
//      from a touched scenario: not whether the CLAIM still reads its PROOF honestly, but
//      whether the PROMISE was meant to die
it('names a removed proof nobody has judged, as removed', () => {
  const removed = gone()

  expect(pendingPromises({ scenarios: [], gone: [removed], entries: [] })).toEqual([
    expect.objectContaining({ key: goneKey(removed), scenario: SCENARIO, kind: 'gone' }),
  ])
})

// Requirement: A change is unsettled until every PROMISE it reached has been judged
// Scenario: A reported problem counts as judged
// GIVEN a touched scenario whose only review reports drift
// WHEN what is still pending is asked for
// THEN it is not among them, because the gate asks whether every PROMISE was judged and not
//      whether every judgement was favourable. A reviewer who cannot pass without unblocking
//      themselves has a reason to write a pass, and the gate would then be measuring their
//      willingness to let themselves through rather than what they found
it('counts a reported problem as judged', () => {
  const scenario = judged()
  const reported = entry({ key: scenarioKey(scenario), verdict: 'drift' })

  expect(pendingPromises({ scenarios: [scenario], gone: NOTHING_GONE, entries: [reported] })).toEqual([])
})

// Requirement: A change is unsettled until every PROMISE it reached has been judged
// Scenario: A change with every PROMISE judged is settled
// GIVEN a change that touched one scenario and removed one PROOF, both of them judged
// WHEN what is still pending is asked for
// THEN nothing is, which is the answer the gate opens on
it('leaves nothing pending once every promise it reached has been judged', () => {
  const scenario = judged()
  const removed = gone('A behavior that is no longer proven')
  const entries = [entry({ key: scenarioKey(scenario) }), entry({ key: goneKey(removed), verdict: 'ok' })]

  expect(pendingPromises({ scenarios: [scenario], gone: [removed], entries })).toEqual([])
})
