// Capability: dispatch

import { expect, it } from 'vitest'
import { computeGraph } from '../../src/dispatch/index.ts'

// Requirement: The graph only reports
// Scenario: The answer carries no order, no hold, no rank, and no recommendation
// GIVEN two in-flight TASK sharing a CAPABILITY_FILE
// WHEN the graph is computed
// THEN neither a TASK nor a relationship carries any field beyond what names the overlap itself
it('carries no field naming an order, a hold, a rank, or a recommendation', () => {
  const graph = computeGraph({
    changes: [
      { task: 'a', editedCapabilities: ['cli'], changedTerms: [], basedOn: undefined },
      { task: 'b', editedCapabilities: ['cli'], changedTerms: [], basedOn: undefined },
    ],
    failures: [],
    vocabulary: { terms: [], capabilities: [] },
  })

  expect(Object.keys(graph).sort()).toEqual(['relationships', 'tasks'])
  for (const task of graph.tasks) expect(Object.keys(task).sort()).toEqual(['basedOn', 'problem', 'reopened', 'task', 'writes'])
  for (const relationship of graph.relationships) expect(Object.keys(relationship).sort()).toEqual(['node', 'tasks'])
})

// Requirement: A TASK that cannot be read carries a problem, and the rest of the graph still answers
// Scenario: A TASK whose branch cannot be read carries a problem, on the answer, naming the TASK and why
// GIVEN a TASK whose branch could not be read
// WHEN the graph is computed
// THEN that TASK's entry names the TASK and carries a problem saying why
it('carries a problem on the answer, naming the TASK and why, when its branch cannot be read', () => {
  const graph = computeGraph({
    changes: [],
    failures: [{ task: 'c', reason: 'branch work/c does not exist' }],
    vocabulary: { terms: [], capabilities: [] },
  })

  expect(graph.tasks).toEqual([
    { task: 'c', writes: [], reopened: [], basedOn: null, problem: 'branch work/c does not exist' },
  ])
})

// Requirement: A TASK that cannot be read carries a problem, and the rest of the graph still answers
// Scenario: Every other TASK's edges are still reported when one TASK cannot be read
// GIVEN one TASK whose branch cannot be read, one TASK with a full set of edges — a write, a
//       reopened edge, and a verified basedOn edge — and a third TASK sharing its write
// WHEN the graph is computed
// THEN the full-edged TASK's writes, reopened edge, and basedOn edge are all still reported,
//      and its relationship with the third TASK still stands
it('still reports every other TASK, in full, when one TASK cannot be read', () => {
  const graph = computeGraph({
    changes: [
      { task: 'a', editedCapabilities: ['cli'], changedTerms: ['FOO'], basedOn: { kind: 'holds', task: 'z', reason: 'needs z' } },
      { task: 'b', editedCapabilities: ['cli'], changedTerms: [], basedOn: undefined },
    ],
    failures: [{ task: 'c', reason: 'branch work/c does not exist' }],
    vocabulary: {
      terms: [{ term: 'FOO', definition: 'a word' }],
      capabilities: [{ capability: 'guard', texts: ['uses FOO'] }],
    },
  })

  const readable = graph.tasks.find(one => one.task === 'a')
  expect(readable).toEqual({
    task: 'a',
    writes: [{ kind: 'capability', name: 'cli' }, { kind: 'term', name: 'FOO' }],
    reopened: [{ kind: 'capability', name: 'guard' }],
    basedOn: { task: 'z', reason: 'needs z' },
    problem: null,
  })
  expect(graph.relationships).toEqual([{ node: { kind: 'capability', name: 'cli' }, tasks: ['a', 'b'] }])
})

// Requirement: A TASK that cannot be read carries a problem, and the rest of the graph still answers
// Scenario: A TASK that cannot be read is not reported as a TASK that relates to nothing
// GIVEN a TASK whose branch cannot be read
// WHEN the graph is computed
// THEN its entry is distinguishable from a TASK that genuinely has no relationships: it carries
//      a problem, where a genuinely quiet TASK carries none
it('is distinguishable from a TASK that genuinely relates to nothing', () => {
  const graph = computeGraph({
    changes: [{ task: 'quiet', editedCapabilities: [], changedTerms: [], basedOn: undefined }],
    failures: [{ task: 'unreadable', reason: 'branch work/unreadable does not exist' }],
    vocabulary: { terms: [], capabilities: [] },
  })

  const quiet = graph.tasks.find(one => one.task === 'quiet')
  const unreadable = graph.tasks.find(one => one.task === 'unreadable')
  expect(quiet?.problem).toBeNull()
  expect(unreadable?.problem).not.toBeNull()
})
