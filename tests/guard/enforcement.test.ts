// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, FILE, committed, scan, site } from './support.ts'

// Requirement: A capability is enforced once a test tags it
// Scenario: A capability file no test tags yet does not fail the build
// GIVEN one capability file whose requirement is proven, and a second whose requirements no
//       test tags yet
// WHEN the guard runs
// THEN the build passes, because a capability nothing tags is planned rather than built,
//      and the spec is authored before the tests that prove it
it('passes when a capability file has requirements no test tags yet', () => {
  const report = guard({
    scans: [
      scan({
        sites: [site({ capability: 'spec-tree', requirement: 'A built requirement', scenario: 'proven' })],
      }),
    ],
    committed: committed({
      'spec-tree': { 'A built requirement': [{ scenario: 'proven', file: FILE }] },
      [CAPABILITY]: { 'A planned requirement': [], 'Another planned requirement': [] },
    }),
  })

  expect(report).toEqual({ status: 'pass', findings: [] })
})

// Requirement: A capability is enforced once a test tags it
// Scenario: A tag naming a capability with no file does not fail the build
// GIVEN a test tagging a capability that no committed file declares
// WHEN the guard runs
// THEN the build passes and the tag is left alone, so an existing suite can adopt ProofSpec
//      one capability at a time instead of retagging everything first
it('passes when a tag names a capability that no committed file declares', () => {
  const report = guard({
    scans: [scan({ sites: [site({ capability: 'a-capability-with-no-file', scenario: 'proven' })] })],
    committed: committed({}),
  })

  expect(report).toEqual({ status: 'pass', findings: [] })
})
