// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import type { TermSpec } from '../../src/spec-file/index.ts'
import { CAPABILITY, REQUIREMENT, committed, scan, site } from './support.ts'

/** A guard run over one committed tree in sync with its one proof site, with a vocabulary. */
function overTerms(terms: readonly TermSpec[]) {
  return guard({
    scans: [scan({ sites: [site({ scenario: 'proven' })] })],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'proven', file: 'tests/example.test.ts' }] },
    }),
    terms,
  })
}

// Requirement: A term defines; it never promises
// Scenario: A Term section that promises fails the build
// GIVEN a vocabulary whose term TURN is defined with a sentence containing SHALL
// WHEN the guard runs
// THEN the build fails naming TURN, because a definition holding a promise is a
//      requirement in disguise that no scenario proves and no gate can see move
it('fails when a Term section promises', () => {
  const report = overTerms([{ term: 'TURN', definition: 'One exchange. The tool SHALL answer it.' }])

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-promises', term: 'TURN' }])
})

// Requirement: A term defines; it never promises
// Scenario: A Term section that only defines passes the guard
// GIVEN a vocabulary whose terms define without promising
// WHEN the guard runs
// THEN the build passes, because saying what a word means is all a term is for
it('passes a Term section that only defines', () => {
  const report = overTerms([{ term: 'TURN', definition: 'One exchange of request and reply.' }])

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([])
})

// Requirement: A term is written the way it is used
// Scenario: A Term heading not written in capitals fails the build
// GIVEN a vocabulary whose term is named Turn rather than TURN
// WHEN the guard runs
// THEN the build fails naming the term, because a promise uses a term in the exact form it
//      was defined in, and a name in lower case is a word no requirement can ever use
it('fails when a term is not written in capitals', () => {
  const report = overTerms([{ term: 'Turn', definition: 'One exchange of request and reply.' }])

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-not-in-capitals', term: 'Turn' }])
})

// Requirement: A term is written the way it is used
// Scenario: Two Term sections defining the same term fail the build
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
