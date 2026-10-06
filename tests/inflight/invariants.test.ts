// Capability: inflight

import { expect, it } from 'vitest'
import { computeGraph } from '../../src/inflight/index.ts'

// Requirement: The graph only reports
// Scenario: The answer carries no order, no hold, no rank, and no recommendation
// GIVEN four in-flight TASK writing differing numbers of CAPABILITY_FILE and sharing three of
//       them — two shared by three TASK, one by two — arriving in one order and then in the
//       reverse order
// WHEN the graph is computed for each arrival
// THEN each shared CAPABILITY_FILE is reported as their relationship, neither a TASK nor a
//      relationship carries any field naming an order, a hold, a rank, or a recommendation,
//      and both arrivals answer the same TASK and relationships in the same order — an order
//      that follows neither the order the TASK arrived in, nor how many TASK a relationship
//      holds, nor how many CAPABILITY_FILE a TASK writes or relationships it sits in
it('carries no order, no hold, no rank, and no recommendation', () => {
  // alpha is shared by three TASK, beta by two, gamma by three: whichever way a ranking by
  // size ran, it would put beta first or last, never between the other two. The TASK differ
  // too — a writes one file, b four, c two, d three (delta and epsilon are each written by one
  // TASK alone, so they add writes and no relationship), and they sit in one, three, two, and
  // two relationships — so no ranking of TASK by writes or by contention, either way round
  // and whatever its tie-break, could answer them in the order they stand.
  const changes = [
    { task: 'c', editedCapabilities: ['gamma', 'alpha'], changedTerms: [], blockedBy: undefined },
    { task: 'a', editedCapabilities: ['alpha'], changedTerms: [], blockedBy: undefined },
    { task: 'd', editedCapabilities: ['beta', 'gamma', 'epsilon'], changedTerms: [], blockedBy: undefined },
    { task: 'b', editedCapabilities: ['alpha', 'delta', 'beta', 'gamma'], changedTerms: [], blockedBy: undefined },
  ]
  const queue = changes.map(change => change.task)
  const graphFrom = (arrival: typeof changes, standing: readonly string[]) =>
    computeGraph({ changes: arrival, failures: [], vocabulary: { terms: [], capabilities: [] }, queue: standing })

  const first = graphFrom(changes, queue)
  const reversed = graphFrom([...changes].reverse(), [...queue].reverse())

  // The order the answer stands in is the same whichever order the TASK arrived in, so no
  // TASK's position — in the queue or in the reading — ranks it over another.
  expect(reversed).toEqual(first)
  expect(new Set(first.tasks.map(one => one.task))).toEqual(new Set(['a', 'b', 'c', 'd']))
  expect(first.tasks).toHaveLength(4)
  const sharedBy = Object.fromEntries(first.relationships.map(one => [one.node.name, one.tasks]))
  expect(first.relationships.every(one => one.node.kind === 'capability')).toBe(true)
  expect(first.relationships).toHaveLength(3)
  expect(new Set(sharedBy.alpha)).toEqual(new Set(['a', 'b', 'c']))
  expect(new Set(sharedBy.beta)).toEqual(new Set(['b', 'd']))
  expect(new Set(sharedBy.gamma)).toEqual(new Set(['b', 'c', 'd']))
  // The relationship two TASK share stands between the two that three share: the answer's
  // order follows no relationship's size, either way round.
  expect(first.relationships.map(one => one.tasks.length)).toEqual([3, 2, 3])
  // Nor does the TASK order follow how much a TASK writes or how many relationships it sits
  // in: read in the order the TASK stand, both counts rise and then fall, so the order is no
  // sort by either count, ascending or descending.
  const writesInOrder = first.tasks.map(one => one.writes.length)
  const contentionInOrder = first.tasks.map(one => first.relationships.filter(relationship => relationship.tasks.includes(one.task)).length)
  expect(writesInOrder).toEqual([1, 4, 2, 3])
  expect(contentionInOrder).toEqual([1, 3, 2, 2])
  for (const counts of [writesInOrder, contentionInOrder]) {
    expect(isSorted(counts, (x, y) => x - y)).toBe(false)
    expect(isSorted(counts, (x, y) => y - x)).toBe(false)
  }

  for (const graph of [first, reversed]) {
    expect(Object.keys(graph).sort()).toEqual(['relationships', 'tasks'])
    for (const task of graph.tasks) expect(Object.keys(task).sort()).toEqual(['blockedBy', 'problem', 'reopened', 'task', 'writes'])
    for (const relationship of graph.relationships) expect(Object.keys(relationship).sort()).toEqual(['node', 'tasks'])
  }
})

/** Whether the counts already stand in the order the comparison sorts them into — ties
 *  allowed, so any stable tie-break would leave them as they are. */
function isSorted(counts: readonly number[], compare: (x: number, y: number) => number): boolean {
  return counts.every((count, index) => index === 0 || compare(counts[index - 1]!, count) <= 0)
}

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
    queue: ['c'],
  })

  expect(graph.tasks).toEqual([
    { task: 'c', writes: [], reopened: [], blockedBy: null, problem: 'branch work/c does not exist' },
  ])
})

// Requirement: A TASK that cannot be read carries a problem, and the rest of the graph still answers
// Scenario: Every other TASK's edges are still reported when one TASK cannot be read
// GIVEN one TASK whose branch cannot be read, one TASK with a full set of edges — a write, a
//       reopened edge, and a blockedBy edge — and a third TASK sharing its write
// WHEN the graph is computed
// THEN the full-edged TASK's writes, reopened edge, and blockedBy edge are all still reported,
//      and its relationship with the third TASK still stands
it('still reports every other TASK, in full, when one TASK cannot be read', () => {
  const graph = computeGraph({
    changes: [
      { task: 'a', editedCapabilities: ['cli'], changedTerms: ['FOO'], blockedBy: { task: 'z', reason: 'needs z' } },
      { task: 'b', editedCapabilities: ['cli'], changedTerms: [], blockedBy: undefined },
    ],
    failures: [{ task: 'c', reason: 'branch work/c does not exist' }],
    vocabulary: {
      terms: [{ term: 'FOO', definition: 'a word' }],
      capabilities: [{ capability: 'guard', texts: ['uses FOO'] }],
    },
    queue: ['a', 'b', 'c', 'z'],
  })

  const readable = graph.tasks.find(one => one.task === 'a')
  expect(readable).toEqual({
    task: 'a',
    writes: [{ kind: 'capability', name: 'cli' }, { kind: 'term', name: 'FOO' }],
    reopened: [{ kind: 'capability', name: 'guard' }],
    blockedBy: { task: 'z', reason: 'needs z' },
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
    changes: [{ task: 'quiet', editedCapabilities: [], changedTerms: [], blockedBy: undefined }],
    failures: [{ task: 'unreadable', reason: 'branch work/unreadable does not exist' }],
    vocabulary: { terms: [], capabilities: [] },
    queue: ['quiet', 'unreadable'],
  })

  const quiet = graph.tasks.find(one => one.task === 'quiet')
  const unreadable = graph.tasks.find(one => one.task === 'unreadable')
  expect(quiet?.problem).toBeNull()
  expect(unreadable?.problem).not.toBeNull()
})
