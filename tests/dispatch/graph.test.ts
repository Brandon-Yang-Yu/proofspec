// Capability: dispatch

import { expect, it } from 'vitest'
import { computeGraph } from '../../src/dispatch/index.ts'
import type { TaskChange } from '../../src/dispatch/index.ts'

function change(task: string, options: Partial<TaskChange> = {}): TaskChange {
  return {
    task,
    editedCapabilities: [],
    changedTerms: [],
    basedOn: undefined,
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
      capabilities: [{ capability: 'dispatch', texts: ['A MANIFEST that cannot stand is refused'] }],
    },
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.reopened).toEqual([{ kind: 'capability', name: 'dispatch' }])
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
      capabilities: [{ capability: 'dispatch', texts: ['Every other TASK still answers'] }],
    },
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.reopened).toEqual([{ kind: 'capability', name: 'dispatch' }])
})

// Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches
// Scenario: A CAPABILITY_FILE both edited and reopened carries only the writes edge
// GIVEN a TASK that edited a capability file its own changed TERM would otherwise reopen
// WHEN the graph is computed
// THEN that file appears only under writes, never under reopened
it('reports only the writes edge for a CAPABILITY_FILE both edited and reopened', () => {
  const graph = computeGraph({
    changes: [change('a', { editedCapabilities: ['dispatch'], changedTerms: ['MANIFEST'] })],
    failures: [],
    vocabulary: {
      terms: [{ term: 'MANIFEST', definition: 'a hand-off' }],
      capabilities: [{ capability: 'dispatch', texts: ['A MANIFEST that cannot stand is refused'] }],
    },
  })

  const task = graph.tasks.find(one => one.task === 'a')
  expect(task?.writes).toEqual([{ kind: 'capability', name: 'dispatch' }, { kind: 'term', name: 'MANIFEST' }])
  expect(task?.reopened).toEqual([])
})

// Requirement: A basedOn edge holds only when the ancestry it claims is real
// Scenario: A basedOn edge carrying its reason is drawn when the claimed ancestry is real
// GIVEN a TASK whose claimed ancestry over another TASK is verified real
// WHEN the graph is computed
// THEN it draws a basedOn edge carrying the claimed reason
it('draws a basedOn edge carrying its reason when the claimed ancestry is real', () => {
  const graph = computeGraph({
    changes: [change('b', { basedOn: { kind: 'holds', task: 'a', reason: "needs a's parser" } })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
  })

  const task = graph.tasks.find(one => one.task === 'b')
  expect(task?.basedOn).toEqual({ task: 'a', reason: "needs a's parser" })
  expect(task?.problem).toBeNull()
})

// Requirement: A basedOn edge holds only when the ancestry it claims is real
// Scenario: A claimed ancestry that does not hold draws no edge and reports a problem naming the claim
// GIVEN a TASK whose claimed ancestry over another TASK does not verify
// WHEN the graph is computed
// THEN it draws no basedOn edge and carries a problem naming the claim
it('draws no basedOn edge and reports a problem when the claimed ancestry does not hold', () => {
  const graph = computeGraph({
    changes: [change('b', { basedOn: { kind: 'broken', task: 'a', reason: "needs a's parser", why: "a's branch is not an ancestor" } })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
  })

  const task = graph.tasks.find(one => one.task === 'b')
  expect(task?.basedOn).toBeNull()
  expect(task?.problem).toBe("claimed basedOn a, but a's branch is not an ancestor")
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no basedOn edge already explaining it
// Scenario: A node two in-flight TASK are attached to is one relationship naming both
// GIVEN two in-flight TASK that both wrote the same CAPABILITY_FILE, with no basedOn edge between them
// WHEN the graph is computed
// THEN one relationship names both TASK on that node
it('reports one relationship naming both TASK sharing a node', () => {
  const graph = computeGraph({
    changes: [change('a', { editedCapabilities: ['cli'] }), change('b', { editedCapabilities: ['cli'] })],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
  })

  expect(graph.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b'] }])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no basedOn edge already explaining it
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
  })

  expect(graph.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b', 'c'] }])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no basedOn edge already explaining it
// Scenario: A node a verified basedOn edge already explains is not reported
// GIVEN two in-flight TASK sharing a node, one of them verified basedOn the other
// WHEN the graph is computed
// THEN no relationship is reported for that node
it('does not report a node a verified basedOn edge already explains', () => {
  const graph = computeGraph({
    changes: [
      change('a', { editedCapabilities: ['cli'] }),
      change('b', { editedCapabilities: ['cli'], basedOn: { kind: 'holds', task: 'a', reason: "needs a's parser" } }),
    ],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
  })

  expect(graph.relationships).toEqual([])
})

// Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no basedOn edge already explaining it
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
  })

  expect(graph.relationships).toEqual([])
})
