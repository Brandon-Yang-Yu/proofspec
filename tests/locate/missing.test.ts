// Capability: locate

import { expect, it } from 'vitest'
import { locate } from '../../src/locate/index.ts'
import { site } from './support.ts'

// Requirement: A scenario that cannot be found is said to be missing
// Scenario: An absent scenario is reported missing, naming what was looked for
// GIVEN proof sites that prove other scenarios but not the one asked about
// WHEN locate is asked where the absent scenario is
// THEN it answers missing and names the capability, requirement and scenario it looked for
it('reports an absent scenario missing, naming what it looked for', () => {
  const sites = [site({ scenario: 'a scenario that exists' })]
  const identity = { capability: 'locate', requirement: 'A requirement', scenario: 'a scenario that does not' }

  const result = locate(sites, identity)

  expect(result).toEqual({ kind: 'missing', identity })
})

// Requirement: A scenario that cannot be found is said to be missing
// Scenario: A near-miss title is not offered as the answer
// GIVEN a proof site whose scenario title differs from the one asked about only slightly
// WHEN locate is asked for the not-quite-matching title
// THEN it answers missing rather than returning the near match's position
it('does not offer a near-miss title as the answer', () => {
  const sites = [site({ scenario: 'the scenario', line: 7 })]
  const identity = { capability: 'locate', requirement: 'A requirement', scenario: 'the scenarios' }

  const result = locate(sites, identity)

  expect(result.kind).toBe('missing')
})
