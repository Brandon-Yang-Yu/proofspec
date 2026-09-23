// Capability: inflight

import { expect, it } from 'vitest'
import { basesFor } from '../../src/inflight/index.ts'
import type { TaskRecord } from '../../src/inflight/index.ts'

function record(task: string, options: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task,
    state: 'in-flight',
    manifest: { intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } },
    ...options,
  }
}

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK whose `base` is of the `main` shape is read from its merge-base with the BASE_BRANCH
// GIVEN an in-flight TASK whose base is `{kind: 'main'}`
// WHEN the graph decides what to measure it against
// THEN it is measured against the BASE_BRANCH, with no basedOn claim to verify
it('measures a TASK whose base is of the main shape against the BASE_BRANCH', () => {
  const bases = basesFor([record('a')])

  expect(bases).toEqual([
    { task: 'a', manifest: record('a').manifest, against: 'main', claim: undefined },
  ])
})

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK whose `base` names an in-flight TASK is read from its merge-base with that branch
// GIVEN an in-flight TASK whose base names another in-flight TASK
// WHEN the graph decides what to measure it against
// THEN it is measured against the named TASK's own branch, carrying the claimed reason
it('measures a TASK whose base names an in-flight TASK against that branch', () => {
  const target = record('a')
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'a', reason: 'needs a\'s parser' } },
  })

  const bases = basesFor([target, dependent])

  expect(bases.find(one => one.task === 'b')).toEqual({
    task: 'b',
    manifest: dependent.manifest,
    against: 'work/a',
    claim: { kind: 'branch', task: 'a', reason: 'needs a\'s parser', branch: 'work/a' },
  })
})

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK whose `base` names a TASK that has merged is read from the BASE_BRANCH instead
// GIVEN an in-flight TASK whose base names a TASK whose own state has reached merged
// WHEN the graph decides what to measure it against
// THEN it is measured against the BASE_BRANCH, with no basedOn claim to verify
it('measures a TASK whose base names a merged TASK against the BASE_BRANCH instead', () => {
  const target = record('a', { state: 'merged' })
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'a', reason: 'needs a\'s parser' } },
  })

  const bases = basesFor([target, dependent])

  expect(bases.find(one => one.task === 'b')).toEqual({
    task: 'b',
    manifest: dependent.manifest,
    against: 'main',
    claim: undefined,
  })
})

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK whose `base` names a TASK not present in the queue at all carries an
//           unresolved claim
// GIVEN an in-flight TASK whose base names a TASK the queue holds no record of
// WHEN the graph decides what to measure it against
// THEN it is measured against `main`, carrying the claim as unresolved rather than silently
//      dropping it
it('carries an unresolved claim when base names a TASK not present in the queue at all', () => {
  const dependent = record('b', {
    manifest: { intentRef: 'docs/y.md', branch: 'work/b', base: { kind: 'task', task: 'ghost', reason: 'needs it' } },
  })

  const bases = basesFor([dependent])

  expect(bases).toEqual([
    { task: 'b', manifest: dependent.manifest, against: 'main', claim: { kind: 'unresolved', task: 'ghost', reason: 'needs it' } },
  ])
})

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK whose own state has reached merged is not read into the graph at all
// GIVEN a TASK whose own state has reached merged
// WHEN the graph decides what to measure
// THEN that TASK is absent from what is measured
it('does not read a merged TASK into the graph at all', () => {
  const bases = basesFor([record('a', { state: 'merged' }), record('b')])

  expect(bases.map(one => one.task)).toEqual(['b'])
})
