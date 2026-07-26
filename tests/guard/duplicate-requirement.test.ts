// Capability: guard

import { expect, it } from 'vitest'
import { guard } from '../../src/guard/index.ts'
import type { RequirementNode, ScenarioNode, SpecTree } from '../../src/spec-tree/index.ts'
import { CAPABILITY, FILE, scan, site } from './support.ts'

/** A requirement declared `times` over, each copy holding the one scenario `proves`. */
function declaredTimes(requirement: string, proves: ScenarioNode, times: number): RequirementNode[] {
  return Array.from({ length: times }, () => ({ requirement, scenarios: [proves] }))
}

// Requirement: A requirement declared twice is a warning
// Scenario: A requirement declared twice in a committed file is a warning
// GIVEN a committed capability file that declares some requirements more than once, each
//       copy holding a scenario the tests prove
// WHEN the guard runs
// THEN every requirement declared more than once is reported once as a warning naming its
//      capability and requirement, a requirement declared once is not, and the build still
//      passes. The `committed()` helper keys requirements by object key and cannot express
//      a repeated heading, so the tree is built by hand
it('warns once per repeated requirement, however many times it was declared, without failing', () => {
  const twice: ScenarioNode = { scenario: 'proves twice', file: FILE }
  const thrice: ScenarioNode = { scenario: 'proves thrice', file: FILE }
  const once: ScenarioNode = { scenario: 'proves once', file: FILE }

  const committed: SpecTree = {
    capabilities: [
      {
        capability: CAPABILITY,
        requirements: [
          ...declaredTimes('Declared twice', twice, 2),
          ...declaredTimes('Declared thrice', thrice, 3),
          ...declaredTimes('Declared once', once, 1),
        ],
      },
    ],
  }

  const report = guard({
    scans: [
      scan({
        sites: [
          site({ scenario: 'proves twice', requirement: 'Declared twice' }),
          site({ scenario: 'proves thrice', requirement: 'Declared thrice' }),
          site({ scenario: 'proves once', requirement: 'Declared once' }),
        ],
      }),
    ],
    committed,
  })

  expect(report.status).toBe('pass')
  expect(report.findings).toEqual([
    { kind: 'duplicate-requirement', capability: CAPABILITY, requirement: 'Declared thrice' },
    { kind: 'duplicate-requirement', capability: CAPABILITY, requirement: 'Declared twice' },
  ])
})
