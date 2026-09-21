// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { docket, exitCodeOf, renderAnswer } from '../../src/cli/index.ts'
import { writePhase } from '../../src/cli/queue.ts'
import { cleanupRepos, makeRepo } from './support.ts'

afterEach(cleanupRepos)

function manifestFor(task: string): string {
  return JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } })
}

/** A queue a person would glance at: one working TASK with a session, one problem, one debt. */
const FILES = {
  '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
  '.proofspec/dispatch/alpha/state': 'building',
  '.proofspec/dispatch/broken/MANIFEST': '{',
  '.proofspec/dispatch/broken/state': 'queued',
  '.proofspec/schedule/raised.jsonl': `${JSON.stringify({ kind: 'raised', key: 'capability:spec-tree:alpha,beta', at: '2026-09-16T10:00:00.000Z' })}\n`,
}

// Requirement: A command answers the docket, as text for a person by default
// Scenario: The docket command answers as text for a person by default
// GIVEN a queue holding a TASK, a problem, and an outstanding ruling
// WHEN the docket command is run with no format named
// THEN the answer is the text a person reads — the TASK's row and its state word — not the JSON a program parses
it('answers the docket as text for a person by default', async () => {
  const repo = await makeRepo(FILES)

  const answer = renderAnswer(await docket({ cwd: repo.root, docket: { listSessions: async () => [] } }))

  expect(answer).toContain('alpha')
  expect(answer).toContain('building')
  expect(() => JSON.parse(answer)).toThrow()
})

// Requirement: A command answers the docket, as text for a person by default
// Scenario: The docket command answers as JSON on request, carrying the same content
// GIVEN the same queue
// WHEN the docket command is asked for JSON
// THEN the answer parses, and carries the same rows, problems, and outstanding rulings the text form does
it('answers the docket as JSON on request, carrying the same content', async () => {
  const repo = await makeRepo(FILES)
  const outcome = await docket({ cwd: repo.root, docket: { listSessions: async () => [] } })

  const answer = renderAnswer(outcome, { format: 'json' })
  const parsed = JSON.parse(answer) as { rows: { task: string; state: string }[]; problems: { task: string }[]; outstanding: { key: string }[] }

  expect(parsed.rows.map(row => row.task)).toEqual(['alpha'])
  expect(parsed.rows[0]?.state).toBe('building')
  expect(parsed.problems.map(problem => problem.task)).toEqual(['broken'])
  expect(parsed.outstanding.map(one => one.key)).toEqual(['capability:spec-tree:alpha,beta'])
})

// Requirement: A command answers the docket, as text for a person by default
// Scenario: The text answer carries the TASK's phase word and its round on its row
// GIVEN a queue holding a TASK whose phase file holds the word test-review at round 2
// WHEN the docket command is run with no format named
// THEN the TASK's line carries the pace word and its round — the question a watching human actually asks, answered in the text a person reads
it('carries the phase word and its round on the text row', async () => {
  const repo = await makeRepo(FILES)
  // `since` pinned to the fixture's own moment so the file holds the shape `readPhase` answers —
  // the row's ages are not this test's question.
  await writePhase(repo.root, 'alpha', { phase: 'test-review', round: 2, since: Date.now() })

  const answer = renderAnswer(await docket({ cwd: repo.root, docket: { listSessions: async () => [] } }))

  expect(answer).toContain('test-review')
  expect(answer).toContain('round 2')
})

// Requirement: A command answers the docket, as text for a person by default
// Scenario: The docket command exits its ok code whatever it finds
// GIVEN a queue whose answer carries a problem, an unknown word, and an unpaid ruling
// WHEN the docket command is run
// THEN it exits its ok code — the command reports the queue, it holds no gate on what it finds
it('exits its ok code whatever the docket finds', async () => {
  const repo = await makeRepo({ ...FILES, '.proofspec/dispatch/alpha/state': 'hibernating' })

  expect(exitCodeOf(await docket({ cwd: repo.root, docket: { listSessions: async () => [] } }))).toBe(0)
})
