// Capability: spec-tree

import { expect, it } from 'vitest'
import { buildTree } from '../../src/spec-tree/index.ts'
import { site } from './support.ts'

// Requirement: The tree counts one entry per scenario and reports collisions
// Scenario: Collisions are reported in a fixed order whatever the scan order
// GIVEN two different scenarios that are each proven at two proof sites
// WHEN the tree is built from those sites in either order
// THEN the collisions are reported in the same fixed order, so a build is reproducible
//      whatever order the scan walked the files
it('reports collisions in a fixed order whatever the scan order', () => {
  const sites = [
    site({ requirement: 'R', scenario: 'zebra', file: 'a.test.ts', line: 1 }),
    site({ requirement: 'R', scenario: 'zebra', file: 'b.test.ts', line: 2 }),
    site({ requirement: 'R', scenario: 'apple', file: 'a.test.ts', line: 3 }),
    site({ requirement: 'R', scenario: 'apple', file: 'b.test.ts', line: 4 }),
  ]

  const forward = buildTree(sites).collisions.map(collision => collision.scenario)
  const reversed = buildTree([...sites].reverse()).collisions.map(collision => collision.scenario)

  expect(forward).toEqual(['apple', 'zebra'])
  expect(reversed).toEqual(['apple', 'zebra'])
})

// Requirement: The tree counts one entry per scenario and reports collisions
// Scenario: The same scenario at two proof sites is reported, naming both
// GIVEN two proof sites that share a capability, a requirement, and a scenario title
// WHEN the tree is built
// THEN one collision is reported, naming both sites' file and line, and the scenario
//      appears only once in the tree
it('reports the same scenario at two proof sites, naming both', () => {
  const sites = [
    site({ requirement: 'R', scenario: 'proven twice', file: 'a.test.ts', line: 5 }),
    site({ requirement: 'R', scenario: 'proven twice', file: 'b.test.ts', line: 9 }),
  ]

  const { tree, collisions } = buildTree(sites)

  expect(collisions).toHaveLength(1)
  const collision = collisions[0]!
  expect(collision).toMatchObject({
    capability: 'spec-tree',
    requirement: 'R',
    scenario: 'proven twice',
  })
  expect(collision.sites).toEqual([
    { file: 'a.test.ts', line: 5 },
    { file: 'b.test.ts', line: 9 },
  ])
  expect(tree.capabilities[0]!.requirements[0]!.scenarios).toHaveLength(1)
})

// Requirement: The tree counts one entry per scenario and reports collisions
// Scenario: The same title under a different requirement is not a collision
// GIVEN two proof sites that share a scenario title but sit under different requirements
// WHEN the tree is built
// THEN no collision is reported, because identity includes the requirement the scenario
//      sits under
it('does not report a shared title under different requirements as a collision', () => {
  const sites = [
    site({ requirement: 'R1', scenario: 'a shared title' }),
    site({ requirement: 'R2', scenario: 'a shared title' }),
  ]

  const { collisions } = buildTree(sites)

  expect(collisions).toEqual([])
})
