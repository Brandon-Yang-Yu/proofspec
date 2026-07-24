// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import type { GuardReport } from '../../src/guard/index.ts'
import { CAPABILITY, REQUIREMENT, committed, scan, scanError, site } from './support.ts'

/** One scan per file, in the order a file walk happened to reach them. */
const SCANS = [
  scan({
    sites: [
      site({ scenario: 'claimed twice', file: 'tests/a.test.ts', line: 3 }),
      site({ scenario: 'undeclared', requirement: 'A requirement no file declares', file: 'tests/a.test.ts', line: 8 }),
    ],
  }),
  scan({
    sites: [
      site({ scenario: 'claimed twice', file: 'tests/b.test.ts', line: 4 }),
      site({ scenario: 'homeless', capability: undefined, file: 'tests/b.test.ts', line: 9 }),
    ],
    errors: [scanError({ kind: 'and-step', file: 'tests/b.test.ts', line: 2 })],
  }),
]

const COMMITTED = committed({
  [CAPABILITY]: {
    [REQUIREMENT]: [{ scenario: 'claimed twice', file: 'tests/a.test.ts' }],
    'A requirement nothing proves': [],
  },
})

function kindsOf(report: GuardReport): readonly string[] {
  return report.findings.map(finding => finding.kind)
}

// Requirement: Two runs over the same tests report the same findings
// Scenario: Findings come in a fixed order whatever order the tests were scanned
// GIVEN tests whose problems are found across two files, scanned in one order and then in
//       the other
// WHEN the guard runs on each scan
// THEN both runs report the same findings in the same order, so a report can be diffed
//      against the one before it rather than read again from the top
it('reports findings in a fixed order whatever order the tests were scanned', () => {
  const forward = guard({ scans: SCANS, committed: COMMITTED })
  const reversed = guard({ scans: [...SCANS].reverse(), committed: COMMITTED })

  expect(kindsOf(reversed)).toEqual(kindsOf(forward))
  expect(kindsOf(forward)).toEqual([
    'unreadable',
    'no-capability',
    'duplicate-scenario',
    'unknown-requirement',
    'uncovered-requirement',
    'scenario-added',
  ])
})
