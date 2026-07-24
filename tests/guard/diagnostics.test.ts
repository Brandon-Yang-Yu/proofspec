// Capability: guard

import { expect, it } from 'vitest'
import { describeFinding } from '../../src/guard/index.ts'
import type { Finding } from '../../src/guard/index.ts'

/**
 * Distinctive fixture text, so an assertion that the message names a part cannot be
 * satisfied by a word the message happened to use anyway.
 */
const CAPABILITY = 'a-named-capability'
const REQUIREMENT = 'The requirement it sits under'
const SCENARIO = 'The scenario it claims'
const IDENTITY = { capability: CAPABILITY, requirement: REQUIREMENT, scenario: SCENARIO }
const FILE = 'tests/somewhere/deep.test.ts'
const SITE = `${FILE}:57`

/** A finding and the parts its message has to name for a reader to act on it. */
type Case = { readonly finding: Finding; readonly names: readonly string[] }

const CAUSED_BY_A_SITE: readonly Case[] = [
  {
    finding: { kind: 'scenario-added', ...IDENTITY, file: FILE, line: 57 },
    names: [CAPABILITY, REQUIREMENT, SCENARIO, SITE],
  },
  {
    finding: { kind: 'scenario-moved', ...IDENTITY, from: 'tests/old.test.ts', to: FILE, line: 57 },
    names: [CAPABILITY, REQUIREMENT, SCENARIO, 'tests/old.test.ts', SITE],
  },
  {
    finding: { kind: 'unknown-requirement', ...IDENTITY, file: FILE, line: 57 },
    names: [CAPABILITY, REQUIREMENT, SCENARIO, SITE],
  },
  {
    finding: {
      kind: 'duplicate-scenario',
      ...IDENTITY,
      sites: [
        { file: FILE, line: 57 },
        { file: 'tests/elsewhere.test.ts', line: 9 },
      ],
    },
    names: [CAPABILITY, REQUIREMENT, SCENARIO, SITE, 'tests/elsewhere.test.ts:9'],
  },
  {
    finding: { kind: 'no-capability', requirement: REQUIREMENT, scenario: SCENARIO, file: FILE, line: 57 },
    names: [REQUIREMENT, SCENARIO, SITE],
  },
  {
    finding: { kind: 'unreadable', reason: 'and-step', message: 'AND is not a step keyword', file: FILE, line: 57 },
    names: [SITE, 'AND is not a step keyword'],
  },
]

const CAUSED_BY_NO_SITE: readonly Case[] = [
  {
    finding: { kind: 'scenario-removed', ...IDENTITY, file: 'tests/old.test.ts' },
    names: [CAPABILITY, REQUIREMENT, SCENARIO, 'tests/old.test.ts'],
  },
  {
    finding: { kind: 'uncovered-requirement', capability: CAPABILITY, requirement: REQUIREMENT },
    names: [CAPABILITY, REQUIREMENT],
  },
]

// Requirement: A failure says what to do about it
// Scenario: A failure caused by a proof site names the site
// GIVEN a failure that a proof site caused
// WHEN its message is written
// THEN the message names the file and line of the site, and every part of the identity the
//      failure carries, so the reader goes straight there instead of being handed the
//      search back
it.each(CAUSED_BY_A_SITE)('names the site and the identity of $finding.kind', ({ finding, names }) => {
  const message = describeFinding(finding)

  for (const name of names) expect(message).toContain(name)
})

// Requirement: A failure says what to do about it
// Scenario: A failure with no proof site names what it is about
// GIVEN a failure that no proof site caused, so there is no line to point at
// WHEN its message is written
// THEN the message names what the failure does have and points at no line, so the reader
//      still knows where to look and is never sent to a position that does not exist
it.each(CAUSED_BY_NO_SITE)('names what it is about without a line: $finding.kind', ({ finding, names }) => {
  const message = describeFinding(finding)

  for (const name of names) expect(message).toContain(name)
  expect(message).not.toMatch(/:\d+/)
})
