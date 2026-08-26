// Capability: review

import { expect, it } from 'vitest'
import { goneKey, requirementKey, scenarioKey } from '../../src/review/index.ts'
import { CAPABILITY, REQUIREMENT, claim, gone, judged, proof } from './support.ts'

// Requirement: A KEY says what it is for
// Scenario: The same CLAIM proven at a different line keeps its KEY
// GIVEN two readings of one scenario whose CLAIM and proving source are identical, taken
//       before and after lines were inserted above the test
// WHEN each is keyed
// THEN both KEY are equal, because a blank line added above a test moved nothing anyone
//      judged, and re-asking for every judgement below it would empty the LEDGER on a
//      formatting change
it('keys the same claim and proof the same however far down the file they sit', () => {
  const before = judged({ claim: claim(), proof: [{ from: 20, to: 21, source: 'expect(a).toBe(b)' }] })
  const after = judged({
    claim: [
      { keyword: 'GIVEN', text: 'a demonstrated arrangement', line: 40 },
      { keyword: 'THEN', text: 'the demonstrated claim holds', line: 41 },
    ],
    proof: [{ from: 50, to: 51, source: 'expect(a).toBe(b)' }],
  })

  expect(scenarioKey(after)).toBe(scenarioKey(before))
})

// Requirement: A KEY says what it is for
// Scenario: A rewritten CLAIM gives the scenario a new KEY
// GIVEN a scenario whose THEN is then reworded
// WHEN it is keyed again
// THEN the KEY has moved, because the PROMISE the reviewer judged is not the PROMISE
//      standing there now
it('moves the key when the claim is reworded', () => {
  const before = judged()
  const after = judged({ claim: claim('the demonstrated claim holds in every case') })

  expect(scenarioKey(after)).not.toBe(scenarioKey(before))
})

// Requirement: A KEY says what it is for
// Scenario: A rewritten PROOF gives the scenario a new KEY
// GIVEN a scenario whose proving lines are then rewritten
// WHEN it is keyed again
// THEN the KEY has moved, because the evidence the reviewer weighed is no longer what sits
//      under the CLAIM
it('moves the key when the proving source is rewritten', () => {
  const before = judged()
  const after = judged({ proof: proof('expect(outcome).toBe(false)') })

  expect(scenarioKey(after)).not.toBe(scenarioKey(before))
})

// Requirement: A KEY says what it is for
// Scenario: A rewritten requirement description gives every scenario under it a new KEY
// GIVEN two scenarios under one requirement, whose description is then reworded
// WHEN each is keyed again
// THEN both KEY have moved, because the description is the STANDARD a CLAIM is judged
//      against, and a moved STANDARD is a judgement worth taking again
it('moves the key of every scenario under a requirement whose description is reworded', () => {
  const reworded = 'The tool SHALL demonstrate the thing it promises, and say so plainly.'
  const first = { scenario: 'A first behavior' }
  const second = { scenario: 'A second behavior' }

  expect(scenarioKey(judged({ ...first, description: reworded }))).not.toBe(scenarioKey(judged(first)))
  expect(scenarioKey(judged({ ...second, description: reworded }))).not.toBe(scenarioKey(judged(second)))
})

// Requirement: A KEY says what it is for
// Scenario: A PROMISE that uses a TERM keys its definition
// GIVEN two readings of one scenario identical except that a TERM its STANDARD uses has
//       been redefined
// WHEN each is keyed
// THEN the KEY differ, because the definition is part of the STANDARD the CLAIM is
//      judged against, and a moved meaning is a judgement worth taking again
it('moves the key when a term the standard uses is redefined', () => {
  const before = judged({ definitions: [{ term: 'TURN', definition: 'One exchange of request and reply.' }] })
  const after = judged({ definitions: [{ term: 'TURN', definition: 'One exchange, reply included.' }] })

  expect(scenarioKey(after)).not.toBe(scenarioKey(before))
})

// Requirement: A KEY says what it is for
// Scenario: A PROMISE that uses no TERM keys exactly as it did with no glossary
// GIVEN the fixture PROMISE, judged with no TERM, and the KEY it was filed under before
//       any glossary existed
// WHEN it is keyed
// THEN the KEY is the one it has always been, because a repository that defines no TERM
//      has its LEDGER stand byte for byte as it stood
it('keys a promise that uses no term exactly as it did with no glossary', () => {
  expect(scenarioKey(judged())).toBe('0e5b6c4fb6b5')
})

// Requirement: A KEY says what it is for
// Scenario: A removed PROOF is keyed by its identity alone
// GIVEN one removed PROOF
// WHEN it is keyed twice, and a differently named removed PROOF is keyed after it
// THEN the first two agree and the third does not, because its name is the only thing a
//      removed PROOF has left — there is no CLAIM and no PROOF to weigh, so nothing about it
//      can move, and the question of whether the PROMISE was meant to die is answered once
it('keys a removed proof by its name, so the answer is given once and stands', () => {
  expect(goneKey(gone())).toBe(goneKey(gone()))
  expect(goneKey(gone('Another behavior'))).not.toBe(goneKey(gone()))
})

// Requirement: A KEY says what it is for
// Scenario: A requirement is addressed by its identity alone
// GIVEN a requirement named by its capability and its own name
// WHEN it is addressed twice, and a differently named requirement is addressed after it
// THEN the first two agree and the third does not, because the address says where to ask
//      rather than what was judged — it takes nothing from the description, so rewording the
//      STANDARD partway through a review cannot move the address out from under the reviewer
it('addresses a requirement by its identity, so nothing but its name can move it', () => {
  const identity = { capability: CAPABILITY, requirement: REQUIREMENT }

  expect(requirementKey(identity)).toBe(requirementKey({ ...identity }))
  expect(requirementKey(identity)).not.toBe(requirementKey({ ...identity, requirement: 'Another promise' }))
})
