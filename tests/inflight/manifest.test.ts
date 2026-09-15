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
  const result = readManifest(JSON.stringify({ intentRef: 'docs/x.md', base: { kind: 'main' } }))

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('branch')
})

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A `base` of a kind that is neither `main` nor `task` is refused
// GIVEN a MANIFEST whose `base.kind` is `other`
// WHEN the MANIFEST is read
// THEN it is refused
it('refuses a base of a kind that is neither main nor task', () => {
  const result = readManifest(
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a', base: { kind: 'other' } }),
  )

  expect(result.ok).toBe(false)
})

// Requirement: A MANIFEST that cannot stand is refused, naming why
// Scenario: A `base` of kind `task` missing its `task` or its `reason` is refused
// GIVEN a MANIFEST whose `base.kind` is `task`, once with no `reason` and once with no `task`
// WHEN the MANIFEST is read
// THEN it is refused either way
it('refuses a base of kind task missing its task or its reason', () => {
  const missingReason = readManifest(
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a', base: { kind: 'task', task: 'other' } }),
  )
  const missingTask = readManifest(
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a', base: { kind: 'task', reason: 'needs it' } }),
  )

  expect.soft(missingReason.ok).toBe(false)
  expect.soft(missingTask.ok).toBe(false)
})
