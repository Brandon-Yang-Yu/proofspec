// Capability: schedule

import { expect, it } from 'vitest'
import { basesFor } from '../../src/dispatch/index.ts'
import type { TaskRecord } from '../../src/dispatch/index.ts'
import { holdStatusFor } from '../../src/schedule/index.ts'

function record(task: string, options: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task,
    state: 'in-flight',
    manifest: { intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } },
    ...options,
  }
}

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK whose base names a still in-flight TASK is held
// GIVEN a TASK whose base names another TASK that is itself still in flight
// WHEN a scheduling pass reads the hold status
// THEN the TASK is held on the named TASK
it('holds a TASK on a base that is still in flight', () => {
  const target = record('a')
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'a', reason: "needs a's work" } },
  })

  const statuses = holdStatusFor(basesFor([target, dependent]))

  expect(statuses).toEqual([{ kind: 'held', task: 'b', on: 'a' }])
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK whose base names a merged TASK is released
// GIVEN a TASK whose base names a TASK whose own state has reached merged
// WHEN a scheduling pass reads the hold status
// THEN the TASK is released, not held
it('releases a TASK once the named TASK has merged', () => {
  const target = record('a', { state: 'merged' })
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'a', reason: "needs a's work" } },
  })

  const statuses = holdStatusFor(basesFor([target, dependent]))

  expect(statuses).toEqual([{ kind: 'released', task: 'b' }])
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK whose base names a TASK absent from the queue entirely is released
// GIVEN a TASK whose base names a TASK the queue holds no record of at all
// WHEN a scheduling pass reads the hold status
// THEN the TASK is released, not held
it('releases a TASK whose named base is not in the queue at all', () => {
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'ghost', reason: 'needs it' } },
  })

  const statuses = holdStatusFor(basesFor([dependent]))

  expect(statuses).toEqual([{ kind: 'released', task: 'b' }])
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK based on main carries no hold status at all
// GIVEN a TASK whose base is main
// WHEN a scheduling pass reads the hold status
// THEN that TASK is absent from the hold statuses — there is nothing to hold it on
it('carries no hold status for a TASK based on main', () => {
  const statuses = holdStatusFor(basesFor([record('a')]))

  expect(statuses).toEqual([])
})
