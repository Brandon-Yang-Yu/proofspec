// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, FILE, committed, scan, site } from './support.ts'

// Requirement: Every declared requirement has something proving it
// Scenario: A declared requirement no test proves fails the build
// GIVEN a capability file declaring two requirements, and tests tagging only one of them
// WHEN the guard runs
// THEN the build fails and the requirement nothing proves is reported as uncovered
it('fails when a declared requirement has no scenario proving it', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'proven', requirement: 'A proven requirement' })] })],
    committed: committed({
      [CAPABILITY]: {
        'A proven requirement': [{ scenario: 'proven', file: FILE }],
        'An unproven requirement': [],
      },
    }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'uncovered-requirement',
      capability: CAPABILITY,
      requirement: 'An unproven requirement',
    },
  ])
})
