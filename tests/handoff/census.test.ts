// Capability: handoff

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runCensusInFlight } from '../../src/handoff/extension.ts'
import { cleanupRepos, makeGitRepo } from '../cli/support.ts'
import type { GitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

const CLI_SPEC = [
  '# cli',
  '',
  '### Requirement: A bare command answers something',
  '',
  'The CLI SHALL answer something when run with no arguments.',
  '',
].join('\n')

/** Branches a TASK off `main`, rewriting `specs/cli.md`'s requirement description there, and
 * enters it into the conventional queue directory — the same shape `enterTask` (`tests/cli/support.ts`)
 * builds, with the branch's own content under this test's exact control. */
async function enterCensusTask(repo: GitRepo, task: string, description: string): Promise<void> {
  await repo.git(['checkout', 'main'])
  await repo.git(['checkout', '-b', `work/${task}`])
  await repo.write(
    'specs/cli.md',
    ['# cli', '', '### Requirement: A bare command answers something', '', description, ''].join('\n'),
  )
  await repo.git(['add', 'specs/cli.md'])
  await repo.git(['commit', '-m', `${task}: rewrite`])
  await repo.git(['checkout', 'main'])

  const manifest = { intentRef: 'specs/cli.md', branch: `work/${task}`, base: { kind: 'main' } }
  await repo.write(`.proofspec/dispatch/${task}/MANIFEST`, JSON.stringify(manifest))
  await repo.write(`.proofspec/dispatch/${task}/state`, 'queued')
}

// Requirement: census_in_flight answers the queue's census for the repo it runs in, writing nothing
// Scenario: An in-flight TASK's rewritten requirement is answered, naming the TASK and its branch
// GIVEN an in-flight TASK whose branch rewrote a requirement's description
// WHEN census_in_flight is called
// THEN it answers that rewritten requirement, naming the TASK and its branch
it('answers a rewritten requirement, naming the TASK and its branch', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': CLI_SPEC })
  await enterCensusTask(repo, 'b', 'The CLI SHALL answer a greeting when run with no arguments.')

  const result = await runCensusInFlight(repo.root)

  expect(result).toEqual({
    ok: true,
    census: {
      tasks: [
        {
          task: 'b',
          branch: 'work/b',
          capabilities: [
            {
              capability: 'cli',
              requirements: [
                {
                  kind: 'reworded',
                  requirement: 'A bare command answers something',
                  before: 'The CLI SHALL answer something when run with no arguments.',
                  after: 'The CLI SHALL answer a greeting when run with no arguments.',
                },
              ],
              terms: [],
            },
          ],
        },
      ],
      failures: [],
    },
  })
})

// Requirement: census_in_flight answers the queue's census for the repo it runs in, writing nothing
// Scenario: An empty queue answers no TASK, rather than a refusal
// GIVEN a repo whose queue directory holds no TASK
// WHEN census_in_flight is called
// THEN it answers no TASK, not a refusal
it('answers no TASK for an empty queue, rather than a refusal', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': CLI_SPEC })

  const result = await runCensusInFlight(repo.root)

  expect(result).toEqual({ ok: true, census: { tasks: [], failures: [] } })
})

// Requirement: census_in_flight answers the queue's census for the repo it runs in, writing nothing
// Scenario: A queue entry naming a branch that does not exist is a named problem, not a thrown error
// GIVEN a queue entry whose MANIFEST names a branch the repository does not have
// WHEN census_in_flight is called
// THEN the problem comes back as a value naming the TASK, never as a thrown error
it('answers a missing branch as a named problem, never a thrown error', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': CLI_SPEC })
  const manifest = { intentRef: 'specs/cli.md', branch: 'work/ghost', base: { kind: 'main' } }
  await repo.write('.proofspec/dispatch/ghost/MANIFEST', JSON.stringify(manifest))
  await repo.write('.proofspec/dispatch/ghost/state', 'queued')

  const result = await runCensusInFlight(repo.root)

  expect(result.ok).toBe(true)
  expect(result.ok && result.census.tasks).toEqual([])
  expect(result.ok && result.census.failures).toEqual([{ task: 'ghost', reason: expect.stringContaining('ghost') }])
})

/**
 * Every entry under a directory, recursively: every path there, whatever kind of entry it is,
 * plus every regular file's own content. `paths` alone catches an added or removed entry;
 * `files` on top of that catches a content edit to a file already there. `git status
 * --porcelain` cannot stand in for this here: the queue directory this test cares about is
 * entirely untracked, and git collapses a whole untracked subtree into one line regardless of
 * what changes inside it.
 */
async function snapshotOf(dir: string): Promise<{ readonly paths: readonly string[]; readonly files: Record<string, string> }> {
  const entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
    // `.git` is git's own housekeeping, not "the working tree or the queue directory" the
    // THEN names — excluded so its internal churn (git may touch it on any command) never
    // masquerades as this capability having written something.
    .filter(entry => entry.parentPath.slice(dir.length + 1).split('/')[0] !== '.git' && entry.name !== '.git')
  const relativePath = (entry: Dirent): string => join(entry.parentPath, entry.name).slice(dir.length + 1)
  const paths = entries.map(relativePath).sort()
  const files = await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(async entry => [relativePath(entry), await readFile(join(dir, relativePath(entry)), 'utf8')] as const),
  )
  return { paths, files: Object.fromEntries(files) }
}

// Requirement: census_in_flight answers the queue's census for the repo it runs in, writing nothing
// Scenario: Nothing on disk is created, changed, or removed
// GIVEN an in-flight TASK whose branch rewrote a requirement
// WHEN census_in_flight is called
// THEN nothing under the working tree or the queue directory is created, changed, or removed
it('writes nothing under the working tree or the queue directory', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': CLI_SPEC })
  await enterCensusTask(repo, 'b', 'The CLI SHALL answer a greeting when run with no arguments.')
  const before = await snapshotOf(repo.root)

  await runCensusInFlight(repo.root)

  expect(await snapshotOf(repo.root)).toEqual(before)
})
