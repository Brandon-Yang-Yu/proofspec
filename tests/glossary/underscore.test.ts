// Capability: glossary

import { expect, it } from 'vitest'
import { termsUsed } from '../../src/glossary/index.ts'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, committed, REQUIREMENT, scan, site } from '../guard/support.ts'

// Requirement: The words of a phrase TERM are joined by underscores
// Scenario: A TERM heading that spaces its words fails the build
// GIVEN a vocabulary whose TERM is named PROOF SITE with a space
// WHEN the guard runs
// THEN the build fails naming the TERM, because two capitals standing beside each
//      other are indistinguishable from ordinary emphasis, and the form is what
//      makes a TERM self-evident
it("fails the build when a TERM heading spaces its words", () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'proven' })] })],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'proven', file: 'tests/example.test.ts' }] },
    }),
    terms: [{ term: 'PROOF SITE', definition: 'One place that claims to prove a scenario.' }],
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'term-not-in-capitals', term: 'PROOF SITE' }])
})

// Requirement: The words of a phrase TERM are joined by underscores
// Scenario: A phrase TERM joined by underscores is one word to the matcher
// GIVEN a PROMISE whose STANDARD writes PROOF_SITE, and a text beside it writing
//      PROOF SITE
// WHEN the terms each is found to use are asked for
// THEN the first uses the TERM and the second does not, because PROOF_SITE is one
//      whole word and PROOF SITE is two words and no term at all
it('matches an underscored phrase TERM as one whole word', () => {
  const standard = termsUsed('The CLAIM names its PROOF_SITE.', ['PROOF_SITE'])
  const beside = termsUsed('The CLAIM names its PROOF SITE.', ['PROOF_SITE'])

  expect([...standard]).toEqual(['PROOF_SITE'])
  expect([...beside]).toEqual([])
})
