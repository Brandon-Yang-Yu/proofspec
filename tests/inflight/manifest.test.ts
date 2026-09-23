// Capability: inflight

import { expect, it } from 'vitest'
import { readManifest } from '../../src/inflight/index.ts'

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A MANIFEST whose JSON does not parse is refused, naming why
// GIVEN a MANIFEST whose text is not valid JSON
// WHEN the MANIFEST is read
// THEN it is refused, naming why
it('refuses a MANIFEST whose JSON does not parse, naming why', () => {
  const result = readManifest('{ not json')

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('JSON')
})

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A MANIFEST missing a required field is refused, naming the field
// GIVEN a MANIFEST whose JSON parses but has no `branch`
// WHEN the MANIFEST is read
// THEN it is refused, naming `branch`
it('refuses a MANIFEST missing a required field, naming the field', () => {
  const result = readManifest(JSON.stringify({ intentRef: 'docs/x.md' }))

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('branch')
})

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A `blocked` present but missing its `task` is refused, naming why
// GIVEN a MANIFEST whose `blocked` carries a `reason` and no `task`
// WHEN the MANIFEST is read
// THEN it is refused, naming the missing `task`
it('refuses a blocked present but missing its task, naming why', () => {
  const result = readManifest(
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a', blocked: { reason: 'needs it' } }),
  )

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('task')
})

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A `blocked` present but missing its `reason` is refused, naming why
// GIVEN a MANIFEST whose `blocked` carries a `task` and no `reason`
// WHEN the MANIFEST is read
// THEN it is refused, naming the missing `reason`
it('refuses a blocked present but missing its reason, naming why', () => {
  const result = readManifest(
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a', blocked: { task: 'other' } }),
  )

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('reason')
})
