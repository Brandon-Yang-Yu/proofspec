// Capability: inflight

import { expect, it } from 'vitest'
import { computeGraph } from '../../src/inflight/index.ts'
import type { TaskChange } from '../../src/inflight/index.ts'

function change(task: string, options: Partial<TaskChange> = {}): TaskChange {
  return {
    task,
    editedCapabilities: [],
    changedTerms: [],
    blockedBy: undefined,
    ...options,
  }
}

// Requirement: The graph reports a writes edge for every CAPABILITY_FILE and TERM a TASK's branch changed
// Scenario: A writes edge is reported for every CAPABILITY_FILE the branch edited
// GIVEN a TASK whose branch edited the cli and guard capability files
// WHEN the graph is computed
// THEN it reports a writes edge from the TASK to each of them
it('reports a writes edge for every CAPABILITY_FILE the branch edited', () => {
  const graph = computeGraph({
    changes: [change('a', { editedCapabilities: ['cli', 'guard'] })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a'],
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.writes).toEqual([
    { kind: 'capability', name: 'cli' },
    { kind: 'capability', name: 'guard' },
  ])
})

// Requirement: The graph reports a writes edge for every CAPABILITY_FILE and TERM a TASK's branch changed
// Scenario: A writes edge is reported for every TERM whose definition the branch changed
// GIVEN a TASK whose branch changed the definition of TERM MANIFEST
// WHEN the graph is computed
// THEN it reports a writes edge from the TASK to that TERM
it('reports a writes edge for every TERM whose definition changed', () => {
  const graph = computeGraph({
    changes: [change('a', { changedTerms: ['MANIFEST'] })],
    failures: [],
    vocabulary: { terms: [{ term: 'MANIFEST', definition: 'a hand-off' }], capabilities: [] },
    queue: ['a'],
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.writes).toEqual([{ kind: 'term', name: 'MANIFEST' }])
})

// Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches
// Scenario: A reopened edge reaches a CAPABILITY_FILE whose requirement words use a changed TERM
// GIVEN a TASK that changed TERM MANIFEST, and a capability file whose requirement uses MANIFEST
// WHEN the graph is computed
// THEN it reports a reopened edge from the TASK to that capability file
it('reaches a CAPABILITY_FILE whose requirement words use a changed TERM', () => {
  const graph = computeGraph({
    changes: [change('a', { changedTerms: ['MANIFEST'] })],
    failures: [],
    vocabulary: {
      terms: [{ term: 'MANIFEST', definition: 'a hand-off' }],
      capabilities: [{ capability: 'inflight', texts: ['A MANIFEST that cannot stand is refused'] }],
    },
    queue: ['a'],
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.reopened).toEqual([{ kind: 'capability', name: 'inflight' }])
})

// Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches
// Scenario: A reopened edge reaches a CAPABILITY_FILE whose requirement words use a TERM that is
//           itself defined in terms of a changed one
// GIVEN a TASK that changed TERM MANIFEST, a TERM TASK defined using MANIFEST, and a capability
//       file whose requirement uses TASK but never MANIFEST
// WHEN the graph is computed
// THEN it reports a reopened edge from the TASK to that capability file
it('reaches a CAPABILITY_FILE whose requirement uses a TERM defined in terms of a changed one', () => {
  const graph = computeGraph({
    changes: [change('a', { changedTerms: ['MANIFEST'] })],
    failures: [],
    vocabulary: {
      terms: [
        { term: 'MANIFEST', definition: 'a hand-off' },
        { term: 'TASK', definition: 'a branch and the MANIFEST committed to it' },
      ],
      capabilities: [{ capability: 'inflight', texts: ['Every other TASK still answers'] }],
    },
    queue: ['a'],
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.reopened).toEqual([{ kind: 'capability', name: 'inflight' }])
})

// Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches
// Scenario: A CAPABILITY_FILE both edited and reopened carries only the writes edge
// GIVEN a TASK that edited a capability file its own changed TERM would otherwise reopen
// WHEN the graph is computed
// THEN that file appears only under writes, never under reopened
it('reports only the writes edge for a CAPABILITY_FILE both edited and reopened', () => {
  const graph = computeGraph({
    changes: [change('a', { editedCapabilities: ['inflight'], changedTerms: ['MANIFEST'] })],
    failures: [],
    vocabulary: {
      terms: [{ term: 'MANIFEST', definition: 'a hand-off' }],
      capabilities: [{ capability: 'inflight', texts: ['A MANIFEST that cannot stand is refused'] }],
    },
    queue: ['a'],
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.writes).toEqual([{ kind: 'capability', name: 'inflight' }, { kind: 'term', name: 'MANIFEST' }])
  expect(task?.reopened).toEqual([])
})

// Requirement: The graph draws a blockedBy edge straight from the MANIFEST
// Scenario: A `blockedBy` edge carrying its reason is drawn straight from the MANIFEST
// GIVEN a TASK whose MANIFEST carries `blocked` naming a TASK that stands on the queue in flight
// WHEN the graph is computed
// THEN a blockedBy edge is drawn to the named TASK, carrying exactly the reason the MANIFEST
//      records
it('draws a blockedBy edge carrying its reason straight from the MANIFEST', () => {
  const graph = computeGraph({
    changes: [change('b', { blockedBy: { task: 'a', reason: "needs a's parser" } })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b'],
  })

  const task = graph.tasks.find(one => one.task === 'b')
  expect(task?.blockedBy).toEqual({ task: 'a', reason: "needs a's parser" })
  expect(task?.problem).toBeNull()
})

// Requirement: The graph draws a blockedBy edge straight from the MANIFEST
// Scenario: A `blockedBy` edge is drawn though neither branch is an ancestor of the other
// GIVEN a blocked TASK where neither its branch nor the blocker's branch is an ancestor of
//       the other — a fact the computation's input never carries, holding only names, edits,
//       and the manifest fact itself
// WHEN the graph is computed
// THEN the edge is drawn anyway and no problem is reported for it — nothing is verified in git
it('draws a blockedBy edge though neither branch is an ancestor of the other', () => {
  const graph = computeGraph({
    changes: [
      change('a'),
      change('b', { blockedBy: { task: 'a', reason: "needs a's parser" } }),
    ],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b'],
  })

  const task = graph.tasks.find(one => one.task === 'b')
  expect(task?.blockedBy).toEqual({ task: 'a', reason: "needs a's parser" })
  expect(task?.problem).toBeNull()
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no blockedBy edge already explaining it
// Scenario: A node a `blockedBy` edge already explains is not reported
// GIVEN two TASK joined by a blockedBy edge and a third, unblocked TASK, all three sharing
//       one spec file
// WHEN relationships are computed
// THEN the blocked pair sharing the file alone raises no relationship — sequencing by design —
//      and the third TASK's overlap with either does raise one, naming all three
it('does not report a node a blockedBy edge already explains', () => {
  const blockedPair = [
    change('a', { editedCapabilities: ['cli'] }),
    change('b', { editedCapabilities: ['cli'], blockedBy: { task: 'a', reason: "needs a's parser" } }),
  ]
  const pair = computeGraph({
    changes: blockedPair,
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b'],
  })
  expect(pair.relationships).toEqual([])

  const withThird = computeGraph({
    changes: [...blockedPair, change('c', { editedCapabilities: ['cli'] })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b', 'c'],
  })
  expect(withThird.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b', 'c'] }])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no blockedBy edge already explaining it
// Scenario: A node two in-flight TASK are attached to is one relationship naming both
// GIVEN two in-flight TASK that both wrote the same CAPABILITY_FILE, with no blockedBy edge between them
// WHEN the graph is computed
// THEN one relationship names both TASK on that node
it('reports one relationship naming both TASK sharing a node', () => {
  const graph = computeGraph({
    changes: [change('a', { editedCapabilities: ['cli'] }), change('b', { editedCapabilities: ['cli'] })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b'],
  })

  expect(graph.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b'] }])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no blockedBy edge already explaining it
// Scenario: A node three TASK share is named once, not as three pairs
// GIVEN three in-flight TASK that all wrote the same CAPABILITY_FILE
// WHEN the graph is computed
// THEN one relationship names all three, not three separate pairs
it('names a node three TASK share once, not as three pairs', () => {
  const graph = computeGraph({
    changes: [
      change('a', { editedCapabilities: ['cli'] }),
      change('b', { editedCapabilities: ['cli'] }),
      change('c', { editedCapabilities: ['cli'] }),
    ],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['a', 'b', 'c'],
  })

  expect(graph.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b', 'c'] }])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no blockedBy edge already explaining it
// Scenario: Two TASK that both changed only unrelated TERM do not relate on the glossary file alone
// GIVEN two in-flight TASK that each changed a different, unrelated TERM
// WHEN the graph is computed
// THEN no relationship is reported on the glossary capability file
it('does not relate two TASK on the glossary file alone', () => {
  const graph = computeGraph({
    changes: [
      change('a', { editedCapabilities: ['glossary'], changedTerms: ['MANIFEST'] }),
      change('b', { editedCapabilities: ['glossary'], changedTerms: ['STANDARD'] }),
    ],
    failures: [],
    vocabulary: {
      terms: [
        { term: 'MANIFEST', definition: 'a hand-off' },
        { term: 'STANDARD', definition: 'a judged description' },
      ],
      capabilities: [],
    },
    queue: ['a', 'b'],
  })

  expect(graph.relationships).toEqual([])
})
