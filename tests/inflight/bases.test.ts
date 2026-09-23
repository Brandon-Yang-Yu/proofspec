// Capability: inflight

import { expect, it } from 'vitest'
import { basesFor, computeGraph } from '../../src/inflight/index.ts'
import type { TaskRecord } from '../../src/inflight/index.ts'

function record(task: string, options: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task,
    state: 'in-flight',
    manifest: { intentRef: 'docs/x.md', branch: `work/${task}` },
    ...options,
  }
}

// Requirement: The graph reads each in-flight TASK from the BASE_BRANCH
// Scenario: A TASK carrying no `blocked` is read from its merge-base with the BASE_BRANCH
// GIVEN a TASK whose MANIFEST carries no `blocked`
// WHEN the graph decides what to measure it against
// THEN it is measured from the merge-base of its branch with the BASE_BRANCH
it('reads a TASK carrying no blocked from its merge-base with the BASE_BRANCH', () => {
  const bases = basesFor([record('a')])

  expect(bases).toEqual([
    { task: 'a', manifest: record('a').manifest, against: 'main' },
  ])
})

// Requirement: The graph reads each in-flight TASK from the BASE_BRANCH
// Scenario: A TASK whose `blocked` names a TASK that has merged is read from the BASE_BRANCH
// GIVEN a TASK blocked on a TASK whose own state has reached merged
// WHEN the graph decides what to measure it against
// THEN it is measured from its merge-base with the BASE_BRANCH, not from the merged TASK's
//      branch
it('reads a TASK whose blocked names a merged TASK from the BASE_BRANCH', () => {
  const target = record('a', { state: 'merged' })
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', blocked: { task: 'a', reason: "needs a's parser" } },
  })

  const bases = basesFor([target, dependent])

  expect(bases.find(one => one.task === 'b')).toEqual({
    task: 'b',
    manifest: dependent.manifest,
    against: 'main',
  })
})

// Requirement: The graph reads each in-flight TASK from the BASE_BRANCH
// Scenario: A TASK whose `blocked` names a TASK not present in the queue at all carries a
//           named problem naming that TASK
// GIVEN a TASK whose `blocked` names a TASK the queue holds no record of
// WHEN the graph decides what to measure it against, and is computed
// THEN it is measured from its merge-base with the BASE_BRANCH like any other, and carries
//      a named problem naming the TASK the queue does not hold
it('carries a named problem naming the TASK when blocked names a TASK not present in the queue at all', () => {
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', blocked: { task: 'ghost', reason: 'needs it' } },
  })

  const bases = basesFor([dependent])
  expect(bases).toEqual([
    { task: 'b', manifest: dependent.manifest, against: 'main' },
  ])

  const graph = computeGraph({
    changes: [{ task: 'b', editedCapabilities: [], changedTerms: [], blockedBy: dependent.manifest.blocked }],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['b'],
  })
  expect(graph.tasks.find(one => one.task === 'b')?.problem).toContain('ghost')
})

// Requirement: The graph reads each in-flight TASK from the BASE_BRANCH
// Scenario: A TASK whose own state has reached merged is not read into the graph at all
// GIVEN a TASK whose own state has reached merged
// WHEN the graph decides what to measure
// THEN that TASK is absent from what is measured
it('does not read a merged TASK into the graph at all', () => {
  const bases = basesFor([record('a', { state: 'merged' }), record('b')])

  expect(bases.map(one => one.task)).toEqual(['b'])
})
