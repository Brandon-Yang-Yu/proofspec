// Capability: inflight

import { expect, it } from 'vitest'
import { computeCensus } from '../../src/inflight/index.ts'
import type { CapabilityRead, TaskCapabilityReads, TaskFailure } from '../../src/inflight/index.ts'
import type { CapabilitySpec, RequirementSpec } from '../../src/spec-file/index.ts'

function requirement(name: string, description: string): RequirementSpec {
  return { requirement: name, description, scenarios: [] }
}

function spec(options: { readonly requirements?: readonly RequirementSpec[]; readonly terms?: readonly { readonly term: string; readonly definition: string }[] } = {}): CapabilitySpec {
  return { capability: 'cli', requirements: options.requirements ?? [], terms: options.terms ?? [] }
}

function read(before: CapabilitySpec, after: CapabilitySpec): CapabilityRead {
  return { capability: 'cli', before, after }
}

function taskRead(task: string, capabilities: readonly CapabilityRead[]): TaskCapabilityReads {
  return { task, branch: `work/${task}`, capabilities }
}

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A rewritten requirement's description is answered as reworded, carrying both texts
// GIVEN a TASK whose branch rewrote one requirement's description
// WHEN the census is computed
// THEN that requirement is answered as reworded, carrying the description as the base had it and as the branch now has it
it('answers a rewritten requirement as reworded, carrying both texts', () => {
  const before = spec({ requirements: [requirement('A bare command answers something', 'the old text')] })
  const after = spec({ requirements: [requirement('A bare command answers something', 'the new text')] })

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [] })

  expect(census).toEqual({
    tasks: [
      {
        task: 'b',
        branch: 'work/b',
        capabilities: [
          {
            capability: 'cli',
            requirements: [
              { kind: 'reworded', requirement: 'A bare command answers something', before: 'the old text', after: 'the new text' },
            ],
            terms: [],
          },
        ],
      },
    ],
    failures: [],
  })
})

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A requirement the branch added is answered as new, carrying only the after text
// GIVEN a TASK whose branch added a requirement the BASE_BRANCH did not declare
// WHEN the census is computed
// THEN that requirement is answered as new, carrying only the text the branch now has
it('answers an added requirement as new, carrying only the after text', () => {
  const before = spec({})
  const after = spec({ requirements: [requirement('A new promise', 'the new text')] })

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [] })

  expect(census.tasks[0]?.capabilities).toEqual([
    { capability: 'cli', requirements: [{ kind: 'new', requirement: 'A new promise', after: 'the new text' }], terms: [] },
  ])
})

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A requirement the branch removed is answered as gone, carrying only the before text
// GIVEN a TASK whose branch removed a requirement the BASE_BRANCH declared
// WHEN the census is computed
// THEN that requirement is answered as gone, carrying only the text the BASE_BRANCH had
it('answers a removed requirement as gone, carrying only the before text', () => {
  const before = spec({ requirements: [requirement('An old promise', 'the old text')] })
  const after = spec({})

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [] })

  expect(census.tasks[0]?.capabilities).toEqual([
    { capability: 'cli', requirements: [{ kind: 'gone', requirement: 'An old promise', before: 'the old text' }], terms: [] },
  ])
})

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A requirement neither end moved is absent from the census entirely
// GIVEN a TASK whose branch left one requirement's description exactly as the BASE_BRANCH had it
// WHEN the census is computed
// THEN that TASK is absent from the census entirely, because it rewrote nothing
it('leaves a TASK that rewrote nothing out of the census entirely', () => {
  const before = spec({ requirements: [requirement('Unmoved', 'same text')] })
  const after = spec({ requirements: [requirement('Unmoved', 'same text')] })

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [] })

  expect(census.tasks).toEqual([])
})

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A rewritten TERM is answered beside that file's rewritten requirements
// GIVEN a TASK whose branch reworded both a TERM and a requirement defined in the same capability file
// WHEN the census is computed
// THEN that TERM is answered beside the rewritten requirement of the file it lives in
it('answers a rewritten TERM beside that file\'s requirements', () => {
  const before = spec({
    requirements: [requirement('A bare command answers something', 'the old text')],
    terms: [{ term: 'MANIFEST', definition: 'old' }],
  })
  const after = spec({
    requirements: [requirement('A bare command answers something', 'the new text')],
    terms: [{ term: 'MANIFEST', definition: 'new' }],
  })

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [] })

  expect(census.tasks[0]?.capabilities).toEqual([
    {
      capability: 'cli',
      requirements: [{ kind: 'reworded', requirement: 'A bare command answers something', before: 'the old text', after: 'the new text' }],
      terms: [{ kind: 'reworded', term: 'MANIFEST', before: 'old', after: 'new' }],
    },
  ])
})

// Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to the BASE_BRANCH
// Scenario: A TASK whose own census could not be read is a named problem, and every other TASK still answers
// GIVEN a queue holding one TASK whose branch could not be read and one whose branch rewrote a requirement
// WHEN the census is computed
// THEN the unreadable TASK is answered as a named problem, and the other TASK's census still answers
it('answers an unreadable TASK as a named problem, and still answers the rest', () => {
  const before = spec({ requirements: [requirement('X', 'old')] })
  const after = spec({ requirements: [requirement('X', 'new')] })
  const failure: TaskFailure = { task: 'broken', reason: 'work/broken is not a revision this repository has' }

  const census = computeCensus({ reads: [taskRead('b', [read(before, after)])], failures: [failure] })

  expect(census.failures).toEqual([failure])
  expect(census.tasks.map(task => task.task)).toEqual(['b'])
})
