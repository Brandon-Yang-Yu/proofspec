// Capability: glossary

import { expect, it } from 'vitest'
import { changedTerms } from '../../src/glossary/index.ts'

const REWORDED = 'One exchange, reply included.'
const ORIGINAL = 'One exchange of request and reply.'

// Requirement: A TERM is changed when its definition is not what it was
// Scenario: A reworded definition changes the TERM
// GIVEN a vocabulary of two TERM, one of whose definitions is then reworded while the
//       other is left exactly as it was
// WHEN the base revision and the working tree are compared
// THEN only the reworded TERM is changed, carrying both definitions, because the other
//      TERM means what it always meant
it('changes a term whose definition was reworded, and only that term', () => {
  const before = [
    { term: 'TURN', definition: ORIGINAL },
    { term: 'REPLY', definition: 'The answer half of a TURN.' },
  ]
  const after = [
    { term: 'TURN', definition: REWORDED },
    { term: 'REPLY', definition: 'The answer half of a TURN.' },
  ]

  expect(changedTerms({ before, after })).toEqual([
    { kind: 'reworded', term: 'TURN', before: ORIGINAL, after: REWORDED },
  ])
})

// Requirement: A TERM is changed when its definition is not what it was
// Scenario: A TERM the base revision does not have is changed
// GIVEN a TERM defined in the working tree that the base revision did not have at all
// WHEN the two vocabularies are compared
// THEN the TERM is changed, carrying no definition it came from, because every PROMISE
//      using it is now standing on ground that was not there
it('changes a term the base revision did not have', () => {
  const changed = changedTerms({ before: [], after: [{ term: 'TURN', definition: ORIGINAL }] })

  expect(changed).toEqual([{ kind: 'new', term: 'TURN', after: ORIGINAL }])
})

// Requirement: A TERM is changed when its definition is not what it was
// Scenario: A TERM the base revision had and this one does not is changed
// GIVEN a TERM the base revision defined that the working tree no longer defines
// WHEN the two vocabularies are compared
// THEN the TERM is changed, carrying no definition it became, because every PROMISE using
//      it has lost the ground it was judged on
it('changes a term the working tree no longer defines', () => {
  const changed = changedTerms({ before: [{ term: 'TURN', definition: ORIGINAL }], after: [] })

  expect(changed).toEqual([{ kind: 'gone', term: 'TURN', before: ORIGINAL }])
})
