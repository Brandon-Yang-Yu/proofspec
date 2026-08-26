// Capability: glossary

import { expect, it } from 'vitest'
import { reopenedByTerms } from '../../src/glossary/index.ts'
import type { PromiseStandard } from '../../src/glossary/index.ts'

/** A promise as the second axis sees it, defaulting every field a given test does not vary. */
function promise(fields: Partial<PromiseStandard> = {}): PromiseStandard {
  return {
    capability: 'demo',
    requirement: 'A demonstrated promise',
    scenario: 'A demonstrated behavior',
    description: 'The tool SHALL demonstrate the thing it promises.',
    claim: [
      { keyword: 'GIVEN', text: 'a demonstrated arrangement', line: 10 },
      { keyword: 'THEN', text: 'the demonstrated claim holds', line: 11 },
    ],
    ...fields,
  }
}

const REDEFINED = { kind: 'reworded', term: 'TURN', before: 'One exchange of request and reply.', after: 'One exchange, reply included.' } as const

// Requirement: A changed TERM re-opens every PROMISE that uses it
// Scenario: A TERM used in a requirement's heading or description re-opens every scenario under it
// GIVEN a changed TERM TURN, one requirement whose description uses it with two scenarios
//       under it, one whose heading uses it with one scenario, and one requirement that
//       does not use it at all
// WHEN every PROMISE the change reaches is found
// THEN every scenario of the two requirements that use TURN is re-opened and none of the
//      one that does not, because their STANDARD moved and its did not
it("re-opens every scenario under a requirement whose heading or description uses the term", () => {
  const promises = [
    promise({ scenario: 'A first behavior', description: 'The tool SHALL answer every TURN.' }),
    promise({ scenario: 'A second behavior', description: 'The tool SHALL answer every TURN.' }),
    promise({ scenario: 'A heading behavior', requirement: 'A TURN is always answered' }),
    promise({ scenario: 'An untouched behavior' }),
  ]

  const reopened = reopenedByTerms({
    changed: [REDEFINED],
    terms: [{ term: 'TURN', definition: 'One exchange, reply included.' }],
    promises,
  })

  expect(reopened.map(one => one.scenario)).toEqual(['A first behavior', 'A second behavior', 'A heading behavior'])
  expect(reopened.map(one => one.reopenedBy)).toEqual([[REDEFINED], [REDEFINED], [REDEFINED]])
})

// Requirement: A changed TERM re-opens every PROMISE that uses it
// Scenario: A TERM used in one scenario's title or steps re-opens that scenario alone
// GIVEN a changed TERM TURN and three scenarios under one requirement, one using TURN in
//       its title, one in its steps, and one not using it at all
// WHEN every PROMISE the change reaches is found
// THEN the two that use TURN are re-opened and the third is not, because it shares the
//      action, not the sentence
it('re-opens only the scenario whose own title or steps use the term', () => {
  const promises = [
    promise({ scenario: 'A TURN is always closed' }),
    promise({ scenario: 'A stepped behavior', claim: [
      { keyword: 'GIVEN', text: 'a demonstrated arrangement', line: 10 },
      { keyword: 'THEN', text: 'the TURN is closed', line: 11 },
    ] }),
    promise({ scenario: 'An untouched behavior' }),
  ]

  const reopened = reopenedByTerms({
    changed: [REDEFINED],
    terms: [{ term: 'TURN', definition: 'One exchange, reply included.' }],
    promises,
  })

  expect(reopened.map(one => one.scenario)).toEqual(['A TURN is always closed', 'A stepped behavior'])
})

// Requirement: A changed TERM re-opens every PROMISE that uses it
// Scenario: A TERM used only inside another TERM's definition re-opens that TERM's users
// GIVEN a changed TERM REPLY that no PROMISE uses directly, and a TERM MARGIN whose
//       definition uses REPLY and that one PROMISE's description does use
// WHEN every PROMISE the change reaches is found
// THEN that PROMISE is re-opened by REPLY's change, because MARGIN is a word built on a
//      word that moved, and it moved with it
it("re-opens the users of a term whose definition uses the changed term", () => {
  const changed = [{ kind: 'reworded', term: 'REPLY', before: 'The answer half.', after: 'The answer half, quoted.' }] as const
  const terms = [
    { term: 'MARGIN', definition: 'The space a REPLY is written in.' },
    { term: 'REPLY', definition: 'The answer half, quoted.' },
  ]
  const promises = [promise({ scenario: 'A margined behavior', description: 'The tool SHALL hold the MARGIN open.' })]

  const reopened = reopenedByTerms({ changed, terms, promises })

  expect(reopened.map(one => one.scenario)).toEqual(['A margined behavior'])
  expect(reopened[0]!.reopenedBy).toEqual(changed)
})

// Requirement: A changed TERM re-opens every PROMISE that uses it
// Scenario: A changed TERM no PROMISE uses re-opens nothing
// GIVEN a changed TERM TURN that no PROMISE's STANDARD uses
// WHEN every PROMISE the change reaches is found
// THEN none is re-opened, because the vocabulary is allowed to hold words nobody leans on
//      yet, and a PROMISE whose STANDARD did not move is not worth judging again
it('re-opens nothing when no promise uses the changed term', () => {
  const reopened = reopenedByTerms({
    changed: [REDEFINED],
    terms: [{ term: 'TURN', definition: 'One exchange, reply included.' }],
    promises: [promise({ scenario: 'An untouched behavior' })],
  })

  expect(reopened).toEqual([])
})
