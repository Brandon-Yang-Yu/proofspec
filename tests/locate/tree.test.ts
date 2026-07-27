// Capability: locate

import { expect, it } from 'vitest'
import { buildTree } from '../../src/spec-tree/index.ts'
import { locateTree } from '../../src/locate/index.ts'
import { site } from './support.ts'

// Requirement: The whole tree can be read at once
// Scenario: Every scenario in the tree is delivered with its file and line
// GIVEN a stable tree and the proof sites it was built from, across more than one capability
//       and requirement
// WHEN the whole tree is located
// THEN the delivered tree holds every capability, requirement and scenario in the tree's
//      order, each scenario carrying its file and line, nothing dropped or reordered
it('delivers every scenario in the tree with its file and line', () => {
  const sites = [
    site({ capability: 'alpha', requirement: 'R1', scenario: 'a-two', file: 'tests/a.test.ts', line: 8 }),
    site({ capability: 'alpha', requirement: 'R1', scenario: 'a-one', file: 'tests/a.test.ts', line: 5 }),
    site({ capability: 'alpha', requirement: 'R2', scenario: 'a-three', file: 'tests/a.test.ts', line: 12 }),
    site({ capability: 'beta', requirement: 'R1', scenario: 'b-one', file: 'tests/b.test.ts', line: 9 }),
  ]

  const positioned = locateTree(buildTree(sites).tree, sites)

  expect(positioned).toEqual({
    capabilities: [
      {
        capability: 'alpha',
        requirements: [
          {
            requirement: 'R1',
            scenarios: [
              { scenario: 'a-one', file: 'tests/a.test.ts', line: 5 },
              { scenario: 'a-two', file: 'tests/a.test.ts', line: 8 },
            ],
          },
          {
            requirement: 'R2',
            scenarios: [{ scenario: 'a-three', file: 'tests/a.test.ts', line: 12 }],
          },
        ],
      },
      {
        capability: 'beta',
        requirements: [{ requirement: 'R1', scenarios: [{ scenario: 'b-one', file: 'tests/b.test.ts', line: 9 }] }],
      },
    ],
  })
})

// Requirement: The whole tree can be read at once
// Scenario: A scenario's file in the tree is its current file, not the tree's stored file
// GIVEN a tree built when a scenario was proven in one file, and sites proving it now in another
// WHEN the tree is located against the now-current sites
// THEN the scenario's entry carries the file it is proven in now, not the file the tree stored —
//      the delivered tree is read from the tests as they stand, not from the committed files
it("carries each scenario the current file, not the tree's stored one", () => {
  const treeWhenOld = buildTree([site({ scenario: 'a scenario', file: 'tests/old.test.ts' })]).tree
  const provenNowIn = [site({ scenario: 'a scenario', file: 'tests/new.test.ts', line: 3 })]

  const positioned = locateTree(treeWhenOld, provenNowIn)

  const scenario = positioned.capabilities[0]!.requirements[0]!.scenarios[0]!
  expect(scenario.file).toBe('tests/new.test.ts')
})

// Requirement: The whole tree can be read at once
// Scenario: A scenario's line in the tree is its current line
// GIVEN a tree plus sites where a test sits at a particular line, and the same tree plus
//       sites where that test has moved down
// WHEN each is located
// THEN the scenario's entry in the delivered tree carries the line the site sits at then —
//      the tree's lines are live, not the tree's stored file re-used with a stale line
it('carries each scenario the current line, not a stale one', () => {
  const before = [site({ scenario: 'a scenario', line: 10 })]
  const after = [site({ scenario: 'a scenario', line: 30 })]

  const lineOf = (sites: typeof before) =>
    locateTree(buildTree(sites).tree, sites).capabilities[0]!.requirements[0]!.scenarios[0]!.line

  expect(lineOf(before)).toBe(10)
  expect(lineOf(after)).toBe(30)
})
