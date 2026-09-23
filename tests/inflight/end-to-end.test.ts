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

// Requirement: A basedOn edge holds only when the ancestry it claims is real
// Scenario: A basedOn claim verified true through real git draws the edge
// GIVEN a TASK whose branch is really built on top of the TASK it claims as its base, both in flight
// WHEN the inflight command is run
// THEN the dependent TASK carries a basedOn edge naming the claimed reason, and no problem
it('draws a basedOn edge through real git when the claimed ancestry is real', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const b = graph.tasks.find(one => one.task === 'b')
  expect(b?.basedOn).toEqual({ task: 'a', reason: "needs a's work" })
  expect(b?.problem).toBeNull()
})

// Requirement: A basedOn edge holds only when the ancestry it claims is real
// Scenario: A basedOn claim verified false through real git reports the problem, not the edge
// GIVEN a TASK whose branch was built independently of the TASK it falsely claims as its base
// WHEN the inflight command is run
// THEN the TASK carries no basedOn edge and a problem naming the claim, while its own writes still show
it('reports a problem through real git when the claimed ancestry is false', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'c', { edit: 'specs/cli.md', base: { kind: 'task', task: 'a', reason: 'claims a, falsely' } })

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const c = graph.tasks.find(one => one.task === 'c')
  expect(c?.basedOn).toBeNull()
  expect(c?.problem).toBe("claimed basedOn a, but a's branch is not an ancestor")
  expect(c?.writes).toEqual([{ kind: 'capability', name: 'cli' }])
})

// Requirement: A basedOn edge holds only when the ancestry it claims is real
// Scenario: A basedOn claim naming a TASK absent from the queue is reported as unresolved end to end
// GIVEN a TASK whose base names a TASK the queue holds no record of
// WHEN the inflight command is run
// THEN the TASK carries no basedOn edge and a problem naming the claim, while its own writes still show
it('reports an unresolved claim through the real command when the named TASK is not in the queue', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md', base: { kind: 'task', task: 'ghost', reason: 'needs it' } })

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const b = graph.tasks.find(one => one.task === 'b')
  expect(b?.basedOn).toBeNull()
  expect(b?.problem).toContain('ghost')
  expect(b?.writes).toEqual([{ kind: 'capability', name: 'cli' }])
})

// Requirement: The graph reads each in-flight TASK from its own base
// Scenario: A TASK based on a merged TASK measures against the BASE_BRANCH even though its own branch was
//           built on top of the merged TASK's
// GIVEN a TASK whose base names a TASK that has since merged into the BASE_BRANCH
// WHEN the census reads what the dependent TASK rewrote
// THEN it is measured from the BASE_BRANCH, not the merged branch, so work the BASE_BRANCH
//      already holds is not counted twice
it('measures against the BASE_BRANCH, not the merged branch, when base names a merged TASK', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/b.md': '# b\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')
  await enterTask(repo, 'b', { edit: 'specs/b.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })

  const graph = graphOf(await inflight({ cwd: repo.root }))

  const b = graph.tasks.find(one => one.task === 'b')
  expect(b?.writes).toEqual([{ kind: 'capability', name: 'a' }, { kind: 'capability', name: 'b' }])
  expect(b?.basedOn).toBeNull()
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
