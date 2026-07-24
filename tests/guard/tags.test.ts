// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import { CAPABILITY, FILE, committed, scan, site } from './support.ts'

// Requirement: Every tag names a requirement that exists
// Scenario: A tag naming a requirement its capability does not declare fails the build
// GIVEN a test tagging a requirement that its capability file does not declare
// WHEN the guard runs
// THEN the build fails and the tag is reported as naming a requirement that does not
//      exist, with the file and line of the site that carries it
it('fails when a tag names a requirement the capability file does not declare', () => {
  const report = guard({
    scans: [
      scan({
        sites: [site({ scenario: 'proven', requirement: 'The requirement under its old name', line: 42 })],
      }),
    ],
    committed: committed({ [CAPABILITY]: { 'The requirement under its new name': [] } }),
  })

  expect(report.status).toBe('fail')
  expect(report.findings).toContainEqual({
    kind: 'unknown-requirement',
    capability: CAPABILITY,
    requirement: 'The requirement under its old name',
    scenario: 'proven',
    file: FILE,
    line: 42,
  })
})
