// Capability: schedule

import { expect, it } from 'vitest'
import { DEFAULT_MAX_SESSIONS, maxSessionsFrom } from '../../src/schedule/index.ts'

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: The live-session bound is four by default
// GIVEN no PROOFSPEC_MAX_SESSIONS value at all
// WHEN the bound is read
// THEN it is four — the default this capability ships with
it('answers a default bound of four when nothing overrides it', () => {
  expect(maxSessionsFrom(undefined)).toBe(DEFAULT_MAX_SESSIONS)
  expect(DEFAULT_MAX_SESSIONS).toBe(4)
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A well-formed PROOFSPEC_MAX_SESSIONS override replaces the default bound
// GIVEN a PROOFSPEC_MAX_SESSIONS value naming a positive whole number
// WHEN the bound is read
// THEN that number is the bound, in place of the default four
it('takes a well-formed override in place of the default four', () => {
  expect(maxSessionsFrom('1')).toBe(1)
  expect(maxSessionsFrom('9')).toBe(9)
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A malformed PROOFSPEC_MAX_SESSIONS override falls back to four rather than silently disabling the bound
// GIVEN a PROOFSPEC_MAX_SESSIONS value that is not a positive whole number — unparsable text,
//       an empty string, zero, or a negative number
// WHEN the bound is read
// THEN the bound is four, never the malformed value and never a reading (like NaN) whose
//      comparison against a live count is always false — the one that would silently disable
//      the bound entirely
it('falls back to four on a malformed override, rather than silently disabling the bound', () => {
  expect(maxSessionsFrom('not-a-number')).toBe(4)
  expect(maxSessionsFrom('')).toBe(4)
  expect(maxSessionsFrom('0')).toBe(4)
  expect(maxSessionsFrom('-2')).toBe(4)
})
