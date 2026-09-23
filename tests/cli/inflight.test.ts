// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { exitCodeOf, inflight, renderAnswer } from '../../src/cli/index.ts'
import type { Graph } from '../../src/inflight/index.ts'
import type { Outcome } from '../../src/cli/index.ts'
import { cleanupRepos, enterTask, makeGitRepo } from './support.ts'

afterEach(cleanupRepos)

function graphOf(outcome: Outcome): Graph {
  if (outcome.kind !== 'inflight') throw new Error(`expected an inflight report, got ${outcome.kind}`)
  return outcome.report
}

// Requirement: A command answers the inflight graph as JSON
// Scenario: The `inflight` command answers JSON by default
// GIVEN a repository with an in-flight TASK whose MANIFEST records a `blocked` naming another TASK on the queue
// WHEN the inflight command is run with no format named
// THEN the answer renders as JSON by default, its TASK carrying a blockedBy edge with the task and reason —
//      no basedOn field, no verified or broken vocabulary anywhere
it('answers the inflight command as JSON by default', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md', blocked: { task: 'b', reason: 'lands behind b' } })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })

  const answer = renderAnswer(await inflight({ cwd: repo.root }))
  const parsed = JSON.parse(answer) as { tasks: { task: string; blockedBy: unknown }[] }

  expect(parsed.tasks.find(one => one.task === 'a')?.blockedBy).toEqual({ task: 'b', reason: 'lands behind b' })
  expect(parsed.tasks.find(one => one.task === 'b')?.blockedBy).toBeNull()
  expect(answer).not.toContain('basedOn')
  expect(answer).not.toContain('verified')
  expect(answer).not.toContain('broken')
})

// Requirement: A command answers the inflight graph as JSON
// Scenario: The command exits its ok code even when the graph carries problems
// GIVEN a repository with one TASK whose MANIFEST names a branch that does not exist
// WHEN the inflight command is run
// THEN it exits its ok code all the same
it('exits its ok code even when the graph carries problems', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await repo.write(
    '.proofspec/dispatch/ghost/MANIFEST',
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/ghost' }),
  )
  await repo.write('.proofspec/dispatch/ghost/state', 'queued')

  const outcome = await inflight({ cwd: repo.root })

  expect(graphOf(outcome).tasks[0]?.problem).not.toBeNull()
  expect(exitCodeOf(outcome)).toBe(0)
})

// Requirement: A conventional queue directory is read one task at a time
// Scenario: The command answers an empty graph in a bare repository with no specs directory at all
// GIVEN a repository with no queue directory and no `specs/` directory either
// WHEN the inflight command is run
// THEN it answers an empty graph rather than a cannot-run, because no TASK is in flight to need
//      the vocabulary a `specs/` directory would supply
it('answers an empty graph in a bare repository with no specs directory at all', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })

  const outcome = await inflight({ cwd: repo.root })

  expect(outcome).toEqual({ kind: 'inflight', report: { tasks: [], relationships: [] } })
})

// Requirement: A conventional queue directory is read one task at a time
// Scenario: A real in-flight TASK still needs the specs directory even when the queue is not empty
// GIVEN a repository with one in-flight TASK in the queue and no `specs/` directory at all
// WHEN the inflight command is run
// THEN it is a cannot-run naming the missing specs directory, because a real TASK's edges do
//      need the vocabulary `specs/` supplies
it('is a cannot-run when a real TASK is in flight but specs cannot be read', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await repo.git(['checkout', '-b', 'work/a'])
  await repo.git(['commit', '--allow-empty', '-m', 'a: edit'])
  await repo.git(['checkout', 'main'])
  await repo.write('.proofspec/dispatch/a/MANIFEST', JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/a' }))
  await repo.write('.proofspec/dispatch/a/state', 'queued')

  const outcome = await inflight({ cwd: repo.root })

  if (outcome.kind !== 'cannot-run') throw new Error(`expected a cannot-run, got ${outcome.kind}`)
  expect(outcome.reason).toContain('specs')
})
