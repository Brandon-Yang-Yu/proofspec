// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, REQUIREMENT, committed, scan, site } from './support.ts'

// Requirement: A scenario claimed by two proof sites fails the build
// Scenario: The same scenario at two proof sites fails the build
// GIVEN the same capability, requirement and scenario tagged at two proof sites
// WHEN the guard runs
// THEN the build fails and every site that claimed the scenario is named. One scenario has
//      one proof, so two proofs mean the action was not the same after all
it('fails when two proof sites claim the same scenario, naming both', () => {
  const report = guard({
    scans: [
      scan({ sites: [site({ scenario: 'proven twice', file: 'tests/a.test.ts', line: 5 })] }),
      scan({ sites: [site({ scenario: 'proven twice', file: 'tests/b.test.ts', line: 9 })] }),
    ],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'proven twice', file: 'tests/a.test.ts' }] },
    }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'duplicate-scenario',
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: 'proven twice',
      sites: [
        { file: 'tests/a.test.ts', line: 5 },
        { file: 'tests/b.test.ts', line: 9 },
      ],
    },
  ])
})
