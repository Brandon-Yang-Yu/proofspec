// Capability: dispatch

import { expect, it } from 'vitest'
import { stateOf } from '../../src/dispatch/index.ts'

// Requirement: A TASK's state is read literally
// Scenario: The literal word `merged` is read as merged
// GIVEN a state word `merged`
// WHEN the state is read
// THEN it reads as merged
it('reads the literal word merged as merged', () => {
  expect(stateOf('merged')).toBe('merged')
})

// Requirement: A TASK's state is read literally
// Scenario: A state word never seen before is read as still in flight
// GIVEN a state word this tool has never met
// WHEN the state is read
// THEN it reads as still in flight
it('reads a state word never seen before as still in flight', () => {
  expect(stateOf('gate-failed')).toBe('in-flight')
})
