// Capability: spec-tree

import { expect, it } from 'vitest'
import { buildTree } from '../../src/spec-tree/index.ts'
import { site } from './support.ts'

// Requirement: The tree is the stable projection of a scan
// Scenario: Sites are grouped under their capability and then their requirement
// GIVEN proof sites spread across two capabilities, one of them with two requirements
// WHEN the tree is built
// THEN each scenario sits under its own capability, then its own requirement
it('groups sites under their capability and requirement', () => {
  const sites = [
    site({ capability: 'alpha', requirement: 'R1', scenario: 'a-one' }),
    site({ capability: 'alpha', requirement: 'R2', scenario: 'a-two' }),
    site({ capability: 'beta', requirement: 'R1', scenario: 'b-one' }),
  ]

  const { tree } = buildTree(sites)

  expect(tree.capabilities.map(node => node.capability)).toEqual(['alpha', 'beta'])
  const alpha = tree.capabilities[0]!
  expect(alpha.requirements.map(node => node.requirement)).toEqual(['R1', 'R2'])
  expect(alpha.requirements[0]!.scenarios.map(node => node.scenario)).toEqual(['a-one'])
  expect(alpha.requirements[1]!.scenarios.map(node => node.scenario)).toEqual(['a-two'])
  const beta = tree.capabilities[1]!
  expect(beta.requirements[0]!.scenarios.map(node => node.scenario)).toEqual(['b-one'])
})

// Requirement: The tree is the stable projection of a scan
// Scenario: A scenario keeps its title and file, not its steps or line
// GIVEN a proof site carrying Gherkin steps and a line number
// WHEN the tree is built
// THEN its scenario node holds the title and the file, and nothing else
it('keeps a scenario title and file, not its steps or line', () => {
  const sites = [
    site({
      scenario: 'a scenario',
      file: 'tests/thing.test.ts',
      line: 42,
      steps: [{ keyword: 'THEN', text: 'it holds', line: 41 }],
    }),
  ]

  const { tree } = buildTree(sites)

  const node = tree.capabilities[0]!.requirements[0]!.scenarios[0]!
  expect(node).toEqual({ scenario: 'a scenario', file: 'tests/thing.test.ts' })
})

// Requirement: The tree is the stable projection of a scan
// Scenario: Sites scanned in any order yield the same tree
// GIVEN the same set of proof sites in two different orders, spanning two capabilities,
//       two requirements under one of them, and two scenarios under one of those
// WHEN each order is built
// THEN the two trees are equal, because every level — capability, requirement, and
//      scenario — is sorted into a fixed order
it('yields the same tree whatever order the sites arrive in', () => {
  const forward = [
    site({ capability: 'beta', requirement: 'R1', scenario: 'b-one' }),
    site({ capability: 'alpha', requirement: 'R2', scenario: 'a-two' }),
    site({ capability: 'alpha', requirement: 'R1', scenario: 'a-one-b' }),
    site({ capability: 'alpha', requirement: 'R1', scenario: 'a-one-a' }),
  ]
  const reversed = [...forward].reverse()

  expect(buildTree(reversed).tree).toEqual(buildTree(forward).tree)
})

// Requirement: The tree is the stable projection of a scan
// Scenario: A collided scenario resolves to the same file whatever order its sites were scanned
// GIVEN one scenario proven in two different files — a collision
// WHEN the tree is built from those sites in either order
// THEN both trees list the scenario under the same single file, so the collision does not
//      make the tree itself unstable
it('resolves a collided scenario to the same file whatever the scan order', () => {
  const inFileA = site({ requirement: 'R', scenario: 'proven twice', file: 'a.test.ts' })
  const inFileB = site({ requirement: 'R', scenario: 'proven twice', file: 'b.test.ts' })

  const forward = buildTree([inFileA, inFileB]).tree
  const reversed = buildTree([inFileB, inFileA]).tree

  expect(forward).toEqual(reversed)
  expect(forward.capabilities[0]!.requirements[0]!.scenarios[0]!.file).toBe('a.test.ts')
})

// Requirement: The tree is the stable projection of a scan
// Scenario: A test moving down its file does not change the tree
// GIVEN two builds of one suite whose sites differ only in their line numbers
// WHEN each is built
// THEN the two trees are equal, because line numbers are not part of the tree
it('is unchanged when a test moves down its file', () => {
  const before = [site({ scenario: 's-one', line: 10 }), site({ scenario: 's-two', line: 20 })]
  const after = [site({ scenario: 's-one', line: 30 }), site({ scenario: 's-two', line: 40 })]

  expect(buildTree(after).tree).toEqual(buildTree(before).tree)
})
