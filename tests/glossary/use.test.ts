// Capability: glossary

import { expect, it } from 'vitest'
import { termsUsed } from '../../src/glossary/index.ts'

// Requirement: A term is used when it appears in the exact form it was defined in
// Scenario: A term is used when it appears as a whole word in the exact form it was defined in
// GIVEN a text that writes the defined term TURN as a whole word, standing alone, ending a
//       sentence, and sitting beside its punctuation
// WHEN the terms the text uses are found
// THEN TURN is used, because the form is the agreement and the text kept it
it('finds a term written whole in the exact form it was defined in', () => {
  const used = termsUsed('Every TURN ends, and the reply of a TURN is part of it (one TURN).', ['TURN'])

  expect([...used]).toEqual(['TURN'])
})

// Requirement: A term is used when it appears in the exact form it was defined in
// Scenario: A word that merely contains the term, or spells it differently, is not a use
// GIVEN a text holding TURNING, turn and Turns, none of them the defined term TURN
// WHEN the terms the text uses are found
// THEN none is a use, because each of them broke the form: one contains the word, the
//      others spell it differently
it('does not find a word that contains the term or spells it differently', () => {
  const used = termsUsed('TURNING is not a use, and neither is turn or Turns.', ['TURN'])

  expect([...used]).toEqual([])
})
