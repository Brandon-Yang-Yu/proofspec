// Capability: schedule

import { expect, it } from 'vitest'
import type { TaskRecord } from '../../src/dispatch/index.ts'
import { entriesToPrune } from '../../src/schedule/index.ts'

function record(task: string, options: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task,
    state: 'in-flight',
    manifest: { intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } },
    ...options,
  }
}

// Requirement: A merged TASK's queue entry is pruned once nothing still names it
// Scenario: A merged TASK no in-flight TASK's base names is pruned
// GIVEN a merged TASK, and no in-flight TASK whose base names it
// WHEN a scheduling pass decides what to prune
// THEN the merged TASK's entry is pruned
it('prunes a merged TASK nothing still names', () => {
  const pruned = entriesToPrune([record('a', { state: 'merged' }), record('b')])

  expect(pruned).toEqual(['a'])
})

// Requirement: A merged TASK's queue entry is pruned once nothing still names it
// Scenario: A merged TASK an in-flight TASK's base still names is not pruned
// GIVEN a merged TASK, and an in-flight TASK whose base names it
// WHEN a scheduling pass decides what to prune
// THEN the merged TASK's entry is not pruned
it('does not prune a merged TASK an in-flight TASK still names', () => {
  const target = record('a', { state: 'merged' })
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'a', reason: "needs a's work" } },
  })

  const pruned = entriesToPrune([target, dependent])

  expect(pruned).toEqual([])
})

// Requirement: A merged TASK's queue entry is pruned once nothing still names it
// Scenario: An in-flight TASK is never pruned
// GIVEN an in-flight TASK
// WHEN a scheduling pass decides what to prune
// THEN that TASK's entry is not pruned
it('never prunes an in-flight TASK', () => {
  const pruned = entriesToPrune([record('a')])

  expect(pruned).toEqual([])
})
