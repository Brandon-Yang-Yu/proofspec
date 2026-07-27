// Capability: locate

import { expect, it } from 'vitest'
import { locate } from '../../src/locate/index.ts'
import { FILE, site } from './support.ts'

const IDENTITY = { capability: 'locate', requirement: 'A requirement', scenario: 'a scenario' }

// Requirement: A position is read from the tests as they stand
// Scenario: A scenario's position is the file and line of its tagged test
// GIVEN a proof site proving a scenario at a known file and line
// WHEN locate is asked where that scenario is
// THEN it reports that file and that line
it('reports the file and line of the tagged test', () => {
  const sites = [site({ scenario: 'a scenario', file: 'tests/thing.test.ts', line: 42 })]

  const found = locate(sites, IDENTITY)

  expect(found).toEqual({ kind: 'found', file: 'tests/thing.test.ts', line: 42 })
})

// Requirement: A position is read from the tests as they stand
// Scenario: The reported line follows the test when lines are inserted above it
// GIVEN the same scenario scanned once, then again after lines are inserted above its test
//       so it sits lower
// WHEN locate is asked where it is each time
// THEN each answer carries the line the test sits at then — nothing is stored or regenerated
it('follows the test down when lines are inserted above it', () => {
  const before = [site({ scenario: 'a scenario', line: 10 })]
  const after = [site({ scenario: 'a scenario', line: 30 })]

  expect(locate(before, IDENTITY)).toEqual({ kind: 'found', file: FILE, line: 10 })
  expect(locate(after, IDENTITY)).toEqual({ kind: 'found', file: FILE, line: 30 })
})
