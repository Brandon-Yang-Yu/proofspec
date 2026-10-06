// Capability: schedule

import { afterEach, expect, it } from 'vitest'
import { DEFAULT_MAX_SESSIONS, maxSessionsFrom } from '../../src/schedule/index.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: The live-session bound is four by default
// GIVEN no settings file at the queue root naming a bound — no file at all, and then a
//       file holding no maxSessions
// WHEN the bound is read
// THEN it is four both times — the default this capability ships with
it('answers a default bound of four when nothing overrides it', async () => {
  const noFile = await makeRepo({})
  const noKey = await makeRepo({ '.proofspec/config.json': '{}' })

  // Four must come from reading the queue root and finding no bound named, never from not
  // reading it at all: a sibling queue root naming one is answered as named.
  const named = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 9 }) })
  expect(await maxSessionsFrom(named.root)).toBe(9)

  expect(await maxSessionsFrom(noFile.root)).toBe(DEFAULT_MAX_SESSIONS)
  expect(await maxSessionsFrom(noKey.root)).toBe(DEFAULT_MAX_SESSIONS)
  expect(DEFAULT_MAX_SESSIONS).toBe(4)
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A well-formed maxSessions value replaces the default bound
// GIVEN a settings file at the queue root whose maxSessions names a positive whole number
// WHEN the bound is read
// THEN that number is the bound, in place of the default four
it('takes a well-formed maxSessions value in place of the default four', async () => {
  const one = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 1 }) })
  const nine = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 9 }) })

  expect(await maxSessionsFrom(one.root)).toBe(1)
  expect(await maxSessionsFrom(nine.root)).toBe(9)
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A malformed maxSessions value falls back to four rather than silently disabling the bound
// GIVEN a settings file at the queue root whose maxSessions is not a positive whole number —
//       zero, a negative number, or a value that is not a number
// WHEN the bound is read
// THEN the bound is four, never the malformed value and never a reading that would
//      silently disable the bound entirely
it('falls back to four on a malformed maxSessions value, rather than silently disabling the bound', async () => {
  const zero = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 0 }) })
  const negative = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: -2 }) })
  const word = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 'many' }) })

  // Four must come from reading the file and refusing its value, never from not reading it at
  // all: a well-formed value at a sibling queue root is answered as written.
  const wellFormed = await makeRepo({ '.proofspec/config.json': JSON.stringify({ maxSessions: 9 }) })
  expect(await maxSessionsFrom(wellFormed.root)).toBe(9)

  expect(await maxSessionsFrom(zero.root)).toBe(4)
  expect(await maxSessionsFrom(negative.root)).toBe(4)
  expect(await maxSessionsFrom(word.root)).toBe(4)
})
