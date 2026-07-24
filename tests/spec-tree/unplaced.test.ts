// Capability: spec-tree

import { expect, it } from 'vitest'
import { buildTree } from '../../src/spec-tree/index.ts'
import { site } from './support.ts'

// Requirement: A proof site with no capability is set aside
// Scenario: A site with no capability is set aside, not placed in the tree
// GIVEN one proof site with a capability and one with none
// WHEN the tree is built
// THEN the site with no capability appears in the set-aside list and in no capability of
//      the tree, so guard can see it rather than it vanishing
it('sets aside a site with no capability instead of placing it', () => {
  const placed = site({ capability: 'spec-tree', scenario: 'placed' })
  const orphan = site({ capability: undefined, scenario: 'orphan' })

  const { tree, unplaced } = buildTree([placed, orphan])

  expect(unplaced.map(entry => entry.scenario)).toEqual(['orphan'])
  const placedScenarios = tree.capabilities.flatMap(capability =>
    capability.requirements.flatMap(requirement =>
      requirement.scenarios.map(scenario => scenario.scenario),
    ),
  )
  expect(placedScenarios).toEqual(['placed'])
})
