// Capability: spec-tree

import { expect, it } from 'vitest'
import { diffTree } from '../../src/spec-tree/index.ts'
import type { SpecTree } from '../../src/spec-tree/index.ts'

/**
 * A one-capability, one-requirement tree over the given scenarios. Identity within a
 * requirement is the title, so this is enough to exercise every kind of difference.
 */
function treeWith(scenarios: readonly { scenario: string; file: string }[]): SpecTree {
  return {
    capabilities: [{ capability: 'spec-tree', requirements: [{ requirement: 'R', scenarios }] }],
  }
}

// Requirement: Two trees are compared by meaning
// Scenario: A scenario only in the regenerated tree is reported as added
// GIVEN a committed tree and a regenerated tree that holds one scenario the committed one
//       does not
// WHEN the two are compared
// THEN the extra scenario is reported as added, under its capability and requirement
it('reports a scenario only in the regenerated tree as added', () => {
  const committed = treeWith([{ scenario: 'kept', file: 'a.test.ts' }])
  const regenerated = treeWith([
    { scenario: 'kept', file: 'a.test.ts' },
    { scenario: 'fresh', file: 'a.test.ts' },
  ])

  const { changes } = diffTree({ committed, regenerated })

  expect(changes).toEqual([
    { kind: 'added', capability: 'spec-tree', requirement: 'R', scenario: 'fresh', file: 'a.test.ts' },
  ])
})

// Requirement: Two trees are compared by meaning
// Scenario: A scenario missing from the regenerated tree is reported as removed
// GIVEN a scenario in the committed tree that the regenerated tree no longer holds
// WHEN the two are compared
// THEN the missing scenario is reported as removed, under its capability and requirement
it('reports a scenario missing from the regenerated tree as removed', () => {
  const committed = treeWith([
    { scenario: 'kept', file: 'a.test.ts' },
    { scenario: 'gone', file: 'a.test.ts' },
  ])
  const regenerated = treeWith([{ scenario: 'kept', file: 'a.test.ts' }])

  const { changes } = diffTree({ committed, regenerated })

  expect(changes).toEqual([
    { kind: 'removed', capability: 'spec-tree', requirement: 'R', scenario: 'gone', file: 'a.test.ts' },
  ])
})

// Requirement: Two trees are compared by meaning
// Scenario: A scenario in a different file is reported as moved
// GIVEN the same scenario proven in a different file between the two trees
// WHEN the two are compared
// THEN it is reported as moved, carrying the file it came from and the file it moved to
it('reports a scenario in a different file as moved', () => {
  const committed = treeWith([{ scenario: 'here', file: 'old.test.ts' }])
  const regenerated = treeWith([{ scenario: 'here', file: 'new.test.ts' }])

  const { changes } = diffTree({ committed, regenerated })

  expect(changes).toEqual([
    {
      kind: 'moved',
      capability: 'spec-tree',
      requirement: 'R',
      scenario: 'here',
      from: 'old.test.ts',
      to: 'new.test.ts',
    },
  ])
})

// Requirement: Two trees are compared by meaning
// Scenario: Differences are reported in a fixed order
// GIVEN two trees that differ in several scenarios at once
// WHEN the two are compared
// THEN the differences come in a fixed order, so two runs on the same pair agree
it('reports differences in a fixed order', () => {
  const committed = treeWith([
    { scenario: 'stays', file: 'a.test.ts' },
    { scenario: 'removed-two', file: 'a.test.ts' },
    { scenario: 'removed-one', file: 'a.test.ts' },
  ])
  const regenerated = treeWith([
    { scenario: 'stays', file: 'a.test.ts' },
    { scenario: 'added-two', file: 'a.test.ts' },
    { scenario: 'added-one', file: 'a.test.ts' },
  ])

  const changes = diffTree({ committed, regenerated }).changes.map(change => change.scenario)

  expect(changes).toEqual(['added-one', 'added-two', 'removed-one', 'removed-two'])
})

// Requirement: Two trees are compared by meaning
// Scenario: Two matching trees compare clean
// GIVEN two trees holding the same scenarios, differing only in the order of their entries
// WHEN the two are compared
// THEN no difference is reported, because order is not a difference
it('reports no change when the two trees match', () => {
  const committed = treeWith([
    { scenario: 's-one', file: 'a.test.ts' },
    { scenario: 's-two', file: 'b.test.ts' },
  ])
  const regenerated = treeWith([
    { scenario: 's-two', file: 'b.test.ts' },
    { scenario: 's-one', file: 'a.test.ts' },
  ])

  const { changes } = diffTree({ committed, regenerated })

  expect(changes).toEqual([])
})
