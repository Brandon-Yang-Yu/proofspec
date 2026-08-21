// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import type { GuardReport } from '../../src/guard/index.ts'
import type { SpecTree } from '../../src/spec-tree/index.ts'
import { CAPABILITY, REQUIREMENT, scan, scanError, site } from './support.ts'

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

// Built by hand rather than with `committed()` so the tree can carry a repeated heading:
// 'A requirement nothing proves' is declared twice and proven by nothing, which yields one
// uncovered-requirement finding (not two) and one duplicate-requirement warning, both of
// which have to take their place in the fixed order.
const COMMITTED: SpecTree = {
  capabilities: [
    {
      capability: CAPABILITY,
      requirements: [
        { requirement: REQUIREMENT, scenarios: [{ scenario: 'claimed twice', file: 'tests/a.test.ts' }] },
        { requirement: 'A requirement nothing proves', scenarios: [] },
        { requirement: 'A requirement nothing proves', scenarios: [] },
      ],
    },
  ],
}

/**
 * A capability declaring two requirements nothing proves, in an order other than by name.
 * They yield two findings of one kind, so their order in the report can only be the guard's
 * own doing — the read hands requirements over in the order the file wrote them.
 */
const DECLARED_OUT_OF_NAME_ORDER: SpecTree = {
  capabilities: [
    {
      capability: CAPABILITY,
      requirements: [
        { requirement: REQUIREMENT, scenarios: [{ scenario: 'claimed twice', file: 'tests/a.test.ts' }] },
        { requirement: 'apple, proven by nothing', scenarios: [] },
        { requirement: 'Zebra, proven by nothing', scenarios: [] },
      ],
    },
  ],
}

function kindsOf(report: GuardReport): readonly string[] {
  return report.findings.map(finding => finding.kind)
}

/** The same tree with every capability declaring its requirements the other way round. */
function inReverseOrder(tree: SpecTree): SpecTree {
  return {
    capabilities: tree.capabilities.map(capability => ({
      ...capability,
      requirements: [...capability.requirements].reverse(),
    })),
  }
}

/** The requirements the report calls uncovered, in the order it reported them. */
function uncoveredIn(report: GuardReport): readonly string[] {
  return report.findings.flatMap(finding =>
    finding.kind === 'uncovered-requirement' ? [finding.requirement] : [],
  )
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
    'duplicate-requirement',
  ])
})

// Requirement: Two runs over the same tests report the same findings
// Scenario: Findings come in a fixed order whatever order a file declares its requirements
// GIVEN one committed capability whose requirements are declared in an order other than by
//       name, and the same capability declaring them the other way round
// WHEN the guard runs on each
// THEN both runs report the same findings in the same order, and the two requirements
//      nothing proves are reported in name order either way, so the report's order is the
//      guard's and not the order someone happened to write the file in
it('reports findings in a fixed order whatever order a file declares its requirements', () => {
  const asDeclared = guard({ scans: SCANS, committed: DECLARED_OUT_OF_NAME_ORDER })
  const reversed = guard({ scans: SCANS, committed: inReverseOrder(DECLARED_OUT_OF_NAME_ORDER) })

  expect(reversed.findings).toEqual(asDeclared.findings)
  expect(uncoveredIn(asDeclared)).toEqual(['Zebra, proven by nothing', 'apple, proven by nothing'])
})
