// Capability: guard

import { expect, it } from 'vitest'
import { guard, VOCABULARY_HOME } from '../../src/guard/index.ts'
import type { TermSpec } from '../../src/spec-file/index.ts'
import { CAPABILITY, REQUIREMENT, committed, scan, site } from './support.ts'

/**
 * A guard run over one committed tree in sync with its one proof site, with a vocabulary.
 * Terms default to the glossary — the only home the guard accepts — so a test about some
 * other term rule is not also a test of this one.
 */
function overTerms(terms: readonly TermSpec[], { capability = VOCABULARY_HOME } = {}) {
  return guard({
    scans: [scan({ sites: [site({ scenario: 'proven' })] })],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'proven', file: 'tests/example.test.ts' }] },
    }),
    terms: terms.map(term => ({ ...term, capability })),
  })
}

// Requirement: A TERM defines; it never promises
// Scenario: A Term section that promises fails the build
// GIVEN a vocabulary whose TERM TURN is defined with a sentence containing SHALL
// WHEN the guard runs
// THEN the build fails naming TURN, because a definition holding a promise is a
//      requirement in disguise that no scenario proves and no gate can see move
it('fails when a Term section promises', () => {
  const report = overTerms([{ term: 'TURN', definition: 'One exchange. The tool SHALL answer it.' }])

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-promises', term: 'TURN' }])
})

// Requirement: A TERM defines; it never promises
// Scenario: A Term section that only defines passes the guard
// GIVEN a vocabulary whose TERM define without promising
// WHEN the guard runs
// THEN the build passes, because saying what a word means is all a TERM is for
it('passes a Term section that only defines', () => {
  const report = overTerms([{ term: 'TURN', definition: 'One exchange of request and reply.' }])

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([])
})

// Requirement: A TERM is written the way it is used
// Scenario: A Term heading not written in capitals fails the build
// GIVEN a vocabulary whose TERM is named Turn rather than TURN
// WHEN the guard runs
// THEN the build fails naming the TERM, because a PROMISE uses a TERM in the exact form it
//      was defined in, and a name in lower case is a word no requirement can ever use
it('fails when a term is not written in capitals', () => {
  const report = overTerms([{ term: 'Turn', definition: 'One exchange of request and reply.' }])

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-not-in-capitals', term: 'Turn' }])
})

// Requirement: A TERM is written the way it is used
// Scenario: Two Term sections defining the same TERM fail the build
// GIVEN a vocabulary defining TURN twice, differently
// WHEN the guard runs
// THEN the build fails naming TURN, because a word with two meanings has no meaning to
//      use, and there is no last definition to fall back on
it('fails when two Term sections define the same term', () => {
  const report = overTerms([
    { term: 'TURN', definition: 'One exchange of request and reply.' },
    { term: 'TURN', definition: 'One exchange, reply included.' },
  ])

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-defined-twice', term: 'TURN' }])
})

// Requirement: A TERM's definition spells a defined TERM in a near form only at the risk of losing the edge
// Scenario: A definition writing a defined TERM in its everyday form warns
// GIVEN a vocabulary whose definition of PROOF_SITE writes claim where CLAIM is defined
// WHEN the guard runs
// THEN a warning names the definition and the everyday spelling and the build still
//      passes, because the reviewer reading the changed definition's then and now is
//      the backstop, and the warning tells them where to look
it('warns when a definition spells a defined TERM in its everyday form', () => {
  const report = overTerms([
    { term: 'PROOF_SITE', definition: 'One place that puts a claim beside the code that bears it.' },
    { term: 'CLAIM', definition: 'The behaviour text of a PROOF_SITE.' },
  ])

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([{ kind: 'term-near-form', term: 'PROOF_SITE', near: 'CLAIM' }])
})

// Requirement: A TERM's definition spells a defined TERM in a near form only at the risk of losing the edge
// Scenario: A verb sharing the TERM's spelling is not a near form
// GIVEN a definition that says "one place that claims to prove"
// WHEN the guard runs
// THEN nothing is reported, because verbs are everyday English and the guard does
//      not stem
it('reports nothing for a verb sharing the TERM spelling', () => {
  const report = overTerms([
    { term: 'PROOF_SITE', definition: 'One place that claims to prove a scenario.' },
    { term: 'CLAIM', definition: 'The behaviour text of a PROOF_SITE.' },
  ])

  expect(report).toEqual({ status: 'pass', findings: [] })
})

// Requirement: A TERM is defined in one place, and that place is the glossary
// Scenario: A Term section defined outside the glossary fails the build
// GIVEN a vocabulary whose TERM LEDGER is defined in the review capability file
// WHEN the guard runs
// THEN the build fails naming LEDGER and the capability it was found in, because the
//      vocabulary is written once, in the glossary, and a definition elsewhere is a
//      second place a reader would have to check for what the word means
it('fails when a Term section is defined outside the glossary', () => {
  const report = overTerms([{ term: 'LEDGER', definition: 'One line per reviewed PROMISE.' }], {
    capability: 'review',
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-outside-glossary', term: 'LEDGER', capability: 'review' }])
})

// Requirement: A TERM is defined in one place, and that place is the glossary
// Scenario: A Term section defined in the glossary passes the guard
// GIVEN a vocabulary whose TERM LEDGER is defined in the glossary
// WHEN the guard runs
// THEN the build passes, because the glossary is where a definition belongs
it('passes a Term section defined in the glossary', () => {
  const report = overTerms([{ term: 'LEDGER', definition: 'One line per reviewed PROMISE.' }])

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([])
})
