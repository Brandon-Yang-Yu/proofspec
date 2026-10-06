// Capability: inflight

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { inflight, renderAnswer } from '../../src/cli/index.ts'
import type { Outcome } from '../../src/cli/index.ts'
import type { Graph } from '../../src/inflight/index.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

function graphOf(outcome: Outcome): Graph {
  if (outcome.kind !== 'inflight') throw new Error(`expected an inflight report, got ${outcome.kind}`)
  return outcome.report
}

// Requirement: The graph only reports
// Scenario: Computing the graph writes nothing to the queue directory
// GIVEN a repository with two in-flight TASK in the queue
// WHEN the inflight command is run
// THEN the whole queue directory holds exactly the entries, and the same file contents, it held
//      before — no sibling task directory added or removed, nothing inside any of them changed
it('writes nothing to the queue directory', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  const queueDir = join(repo.root, '.proofspec', 'dispatch')
  const before = await snapshotOf(queueDir)

  await inflight({ cwd: repo.root })

  expect(await snapshotOf(queueDir)).toEqual(before)
})

/**
 * Every entry under a directory, recursively: the full path of everything there, whatever kind
 * of entry it is, plus every regular file's path mapped to its contents. `paths` is built with
 * no type filter at all, so an added or removed entry of any kind — a directory, a file, a
 * symlink — changes it; `files` on top of that catches a content edit to a file already there.
 */
async function snapshotOf(dir: string): Promise<{ readonly paths: readonly string[]; readonly files: Record<string, string> }> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const relativePath = (entry: Dirent): string => join(entry.parentPath, entry.name).slice(dir.length + 1)
  const paths = entries.map(relativePath).sort()
  const files = await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(async entry => [relativePath(entry), await readFile(join(dir, relativePath(entry)), 'utf8')] as const),
  )
  return { paths, files: Object.fromEntries(files) }
}

// Requirement: The graph is computed fresh from git on every run
// Scenario: Two runs over an unmoved repository answer identically, in the same order
// GIVEN a repository with two in-flight TASK sharing a capability file
// WHEN the inflight command is run twice with nothing in between
// THEN both runs answer byte-for-byte the same JSON
it('answers identically, in the same order, on two runs over an unmoved repository', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })

  const first = renderAnswer(await inflight({ cwd: repo.root }))
  const second = renderAnswer(await inflight({ cwd: repo.root }))

  expect(first).toBe(second)
  expect(JSON.parse(first).relationships).toHaveLength(1)
})

// Requirement: The graph draws a blockedBy edge straight from the MANIFEST
// Scenario: A `blocked` naming a TASK absent from the queue is a named problem, not a broken claim
// GIVEN a TASK blocked on a name the queue does not hold
// WHEN the inflight command is run
// THEN the answer carries a problem naming that TASK, the blockedBy edge still stands, and no
//      ancestry verdict appears anywhere
it('names a problem, not a broken claim, when blocked names a TASK absent from the queue', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  await repo.write(
    '.proofspec/dispatch/b/MANIFEST',
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/b', blocked: { task: 'ghost', reason: 'needs it' } }),
  )

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const b = graph.tasks.find(one => one.task === 'b')
  expect(b?.problem).toContain('ghost')
  expect(b?.blockedBy).toEqual({ task: 'ghost', reason: 'needs it' })
  expect(b?.writes).toEqual([{ kind: 'capability', name: 'cli' }])
  expect(JSON.stringify(graph)).not.toContain('ancestor')
})

// Requirement: The graph reads each in-flight TASK from the BASE_BRANCH
// Scenario: A TASK whose `blocked` names a merged TASK measures against the BASE_BRANCH even
//           though its own branch was built on the merged TASK's
// GIVEN a TASK whose `blocked` names a TASK that has since merged, while its own branch was
//       built on top of the merged TASK's
// WHEN the census reads what the dependent TASK rewrote
// THEN it is measured from the BASE_BRANCH, not the merged branch, so work the BASE_BRANCH
//      already holds is not counted twice
it('measures against the BASE_BRANCH, not the merged branch, when blocked names a merged TASK', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/b.md': '# b\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')
  await enterTask(repo, 'b', { edit: 'specs/b.md', onto: 'work/a' })
  await repo.write(
    '.proofspec/dispatch/b/MANIFEST',
    JSON.stringify({ intentRef: 'docs/x.md', branch: 'work/b', blocked: { task: 'a', reason: "needs a's work" } }),
  )

  const graph = graphOf(await inflight({ cwd: repo.root }))

  // Before a's work lands, the BASE_BRANCH does not hold it, so b is charged with it.
  const b = graph.tasks.find(one => one.task === 'b')
  expect(b?.writes).toEqual([{ kind: 'capability', name: 'a' }, { kind: 'capability', name: 'b' }])
  expect(b?.blockedBy).toEqual({ task: 'a', reason: "needs a's work" })

  await repo.git(['merge', '--no-ff', '-m', 'land a', 'work/a'])
  const landed = graphOf(await inflight({ cwd: repo.root }))

  // Once the BASE_BRANCH holds a's work, b's writes no longer count it a second time.
  const bAfterLanding = landed.tasks.find(one => one.task === 'b')
  expect(bAfterLanding?.writes).toEqual([{ kind: 'capability', name: 'b' }])
})

// Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches
// Scenario: A changed TERM in a real glossary file reopens a real CAPABILITY_FILE that uses it
// GIVEN a repository whose glossary defines a TERM another CAPABILITY_FILE's requirement uses,
//       and a TASK whose branch changes that TERM's definition
// WHEN the inflight command is run
// THEN the TASK carries a reopened edge to the other CAPABILITY_FILE
it('reopens a real CAPABILITY_FILE through a real glossary TERM change', async () => {
  const repo = await makeGitRepo({
    'specs/glossary.md': '### Term: FOO\n\nThe original definition.\n',
    'specs/bar.md': '### Requirement: Something about FOO\n\nUses FOO in its own words.\n',
  })
  await enterTask(repo, 'a', { edit: 'specs/glossary.md' })

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const a = graph.tasks.find(one => one.task === 'a')
  expect(a?.writes).toEqual([{ kind: 'capability', name: 'glossary' }, { kind: 'term', name: 'FOO' }])
  expect(a?.reopened).toEqual([{ kind: 'capability', name: 'bar' }])
})
