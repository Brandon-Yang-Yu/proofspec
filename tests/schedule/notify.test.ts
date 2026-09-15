// Capability: schedule

import { afterEach, expect, it, vi } from 'vitest'
import { stderrNotifyHuman } from '../../src/cli/notify.ts'
import type { Relationship } from '../../src/inflight/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const RELATIONSHIP: Relationship = { node: { kind: 'capability', name: 'schedule' }, tasks: ['a', 'b'] }

// Chosen so none of them is a substring of the message's own fixed wording ("an unresolved
// relationship needs a human", "shared by", "answer with", "proofspec schedule --ruling") —
// a test asserting .toContain('a') or .toContain('schedule') would pass against that
// boilerplate alone, whether or not the task/node names were ever actually interpolated in.
const DISTINCTIVE_RELATIONSHIP: Relationship = { node: { kind: 'capability', name: 'wolverine-glossary' }, tasks: ['task-fenrir', 'task-yggdrasil'] }

// Requirement: The bare CLI's notifyHuman writes the finding to stderr, and nothing more
// Scenario: An unresolved relationship's finding is written to stderr, not stdout
// GIVEN an unresolved relationship naming two TASKs and a shared capability file
// WHEN the bare CLI's notifyHuman action runs on it
// THEN the message is written to stderr and nothing is written to stdout
it('writes the finding to stderr, never stdout', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

  await stderrNotifyHuman()(RELATIONSHIP)

  expect(stderr).toHaveBeenCalled()
  expect(stdout).not.toHaveBeenCalled()
})

// Requirement: The bare CLI's notifyHuman writes the finding to stderr, and nothing more
// Scenario: The stderr message names both TASKs, the shared node, and the relationship's own key
// GIVEN an unresolved relationship whose TASK and node names share no substring with the
//       message's own fixed wording
// WHEN notifyHuman runs on it
// THEN the message names both TASKs, the shared node, and the relationship's exact key —
//      not merely wording that happens to already appear in the message regardless
it('names both TASKs, the shared node, and the relationship key in the message', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  await stderrNotifyHuman()(DISTINCTIVE_RELATIONSHIP)

  const written = stderr.mock.calls.map(call => String(call[0])).join('')
  expect(written).toBe(
    'schedule: an unresolved relationship needs a human — capability "wolverine-glossary" shared by task-fenrir, task-yggdrasil\n' +
      '  answer with: proofspec schedule --ruling "<your ruling>" \'capability:wolverine-glossary:task-fenrir,task-yggdrasil\'\n',
  )
})
