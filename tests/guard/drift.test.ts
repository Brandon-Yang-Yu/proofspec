// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, FILE, REQUIREMENT, committed, scan, site } from './support.ts'

// Requirement: A disagreement between the tests and the committed files fails the build
// Scenario: A scenario the committed file does not record fails the build
// GIVEN a capability file recording one scenario, and tests proving a second one under the
//       same requirement
// WHEN the guard runs
// THEN the build fails and the extra scenario is named as added, under the capability and
//      the requirement it belongs to, at the site that proves it
it('fails when the tests prove a scenario the committed file does not record', () => {
  const report = guard({
    scans: [
      scan({ sites: [site({ scenario: 'recorded', line: 12 }), site({ scenario: 'extra', line: 24 })] }),
    ],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'recorded', file: FILE }] },
    }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'scenario-added',
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: 'extra',
      file: FILE,
      line: 24,
    },
  ])
})

// Requirement: A disagreement between the tests and the committed files fails the build
// Scenario: A scenario the tests no longer prove fails the build
// GIVEN a capability file recording a scenario that no test tags any more
// WHEN the guard runs
// THEN the build fails and the scenario is named as removed, under the capability and the
//      requirement it belongs to
it('fails when the committed file records a scenario the tests no longer prove', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'kept' })] })],
    committed: committed({
      [CAPABILITY]: {
        [REQUIREMENT]: [
          { scenario: 'kept', file: FILE },
          { scenario: 'gone', file: FILE },
        ],
      },
    }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'scenario-removed',
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: 'gone',
      file: FILE,
    },
  ])
})

// Requirement: A disagreement between the tests and the committed files fails the build
// Scenario: A scenario proven in another file fails the build
// GIVEN a scenario recorded against one file and now proven in another
// WHEN the guard runs
// THEN the build fails and the scenario is named as moved, carrying the file it was
//      recorded against and the site that proves it now
it('fails when a scenario is proven in a file other than the one recorded', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'here', file: 'tests/new.test.ts', line: 31 })] })],
    committed: committed({
      [CAPABILITY]: { [REQUIREMENT]: [{ scenario: 'here', file: 'tests/old.test.ts' }] },
    }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toEqual([
    {
      kind: 'scenario-moved',
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: 'here',
      from: 'tests/old.test.ts',
      to: 'tests/new.test.ts',
      line: 31,
    },
  ])
})

// Requirement: A disagreement between the tests and the committed files fails the build
// Scenario: Tests matching the committed files pass
// GIVEN tests whose scenarios are exactly the ones the capability file records
// WHEN the guard runs
// THEN the build passes with nothing reported
it('passes when the tests and the committed file agree', () => {
  const report = guard({
    scans: [scan({ sites: [site({ scenario: 'one' }), site({ scenario: 'two' })] })],
    committed: committed({
      [CAPABILITY]: {
        [REQUIREMENT]: [
          { scenario: 'one', file: FILE },
          { scenario: 'two', file: FILE },
        ],
      },
    }),
  })

  expect(report).toEqual({ status: 'pass', findings: [] })
})

// Requirement: A disagreement between the tests and the committed files fails the build
// Scenario: A test that moved down its file compares clean
// GIVEN a capability file recording where two scenarios are proven, and lines inserted
//       above both of their tests so every position in the file has shifted
// WHEN the guard runs
// THEN the build passes with nothing reported, because line numbers take no part in the
//      comparison
it('compares clean when a tagged test moves down its file', () => {
  const report = guard({
    scans: [
      scan({ sites: [site({ scenario: 'one', line: 210 }), site({ scenario: 'two', line: 220 })] }),
    ],
    committed: committed({
      [CAPABILITY]: {
        [REQUIREMENT]: [
          { scenario: 'one', file: FILE },
          { scenario: 'two', file: FILE },
        ],
      },
    }),
  })

  expect(report).toEqual({ status: 'pass', findings: [] })
})
