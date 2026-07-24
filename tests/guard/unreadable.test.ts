// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, FILE, REQUIREMENT, committed, scan, scanError, site } from './support.ts'

// Requirement: A proof site the tree cannot hold fails the build
// Scenario: A tagged site in a file that declares no capability fails the build
// GIVEN a tagged proof site in a file that declares no capability, so the scan could not
//       place it
// WHEN the guard runs
// THEN the build fails and the site is reported as having no capability to sit under, with
//      its file and line
it('fails when a tagged site sits in a file that declares no capability', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'orphan', capability: undefined, line: 7 })] })],
    committed: committed({}),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'no-capability',
      requirement: REQUIREMENT,
      scenario: 'orphan',
      file: FILE,
      line: 7,
    },
  ])
})

// Requirement: A proof site the tree cannot hold fails the build
// Scenario: A tagged site with no Gherkin steps is a warning
// GIVEN a tagged proof site with no GIVEN, WHEN or THEN above it
// WHEN the guard runs
// THEN the site is reported as a warning naming its file and line, and the build still
//      passes. It is co-location in name only: there is a tag, but no claim to judge the
//      test against, which is worth saying and not worth stopping for
it('warns without failing when a tagged site carries no Gherkin steps', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'proven', steps: [], line: 12 })] })],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'proven', file: FILE }] },
    }),
  })

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([
    {
      kind: 'no-steps',
      requirement: REQUIREMENT,
      scenario: 'proven',
      file: FILE,
      line: 12,
    },
  ])
})

// Requirement: A proof site the tree cannot hold fails the build
// Scenario: Anything the scan could not read fails the build
// GIVEN a scan reporting something it could not read
// WHEN the guard runs
// THEN the build fails and what the scan reported is carried through with its file and
//      line. The scan reports what it found; deciding that a build cannot proceed is this
//      capability's job
it.each([
  { reason: 'and-step', message: 'AND is not a step keyword' },
  { reason: 'mixed-placement', message: 'this test tags both above itself and inside its body' },
  { reason: 'second-capability', message: 'this file declares a second capability' },
] as const)('fails on what the scan could not read: $reason', ({ reason, message }) => {
  const report = guard({
    scans: [scan({ errors: [scanError({ kind: reason, message, line: 31 })] })],
    committed: committed({}),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([{ kind: 'unreadable', reason, message, file: FILE, line: 31 }])
})
