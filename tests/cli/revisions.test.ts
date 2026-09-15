// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { changedPathsBetween, isAncestor, mergeBase, pathsAtEither } from '../../src/cli/git.ts'
import { cleanupRepos, makeGitRepo } from './support.ts'

afterEach(cleanupRepos)

// Requirement: Two revisions can be compared without checking either one out
// Scenario: Where two revisions last agreed is answered without either being checked out
// GIVEN a repository where a branch diverged from main after one shared commit
// WHEN the merge base of main and the branch is asked for
// THEN it answers the commit they both still agree on, and the checked-out branch never moved
it('answers where two revisions last agreed without checking either one out', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  const shared = await repo.git(['rev-parse', 'HEAD'])
  await repo.git(['checkout', '-b', 'work'])
  await repo.write('a.txt', 'b')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'on work'])
  // `git checkout`/`switch` always appends a reflog entry; the read-only plumbing
  // `mergeBase` is meant to use never does — so an unmoved reflog is direct proof nothing
  // was ever checked out, not just that the branch ended up back where it started.
  const reflogBefore = await repo.git(['reflog', '--format=%H %gs'])

  const result = await mergeBase({ cwd: repo.root, a: 'main', b: 'work' })

  expect(result).toEqual({ ok: true, base: shared })
  expect(await repo.git(['reflog', '--format=%H %gs'])).toBe(reflogBefore)
})

// Requirement: Two revisions can be compared without checking either one out
// Scenario: Which paths under a pathspec differ between two revisions is answered
// GIVEN a branch that edited one file under a pathspec and left another alone
// WHEN the paths that differ between main and the branch are asked for, scoped to that pathspec
// THEN only the edited file under the pathspec comes back
it('answers which paths under a pathspec differ between two revisions', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': 'one', 'specs/b.md': 'two', 'other/c.md': 'three' })
  await repo.git(['checkout', '-b', 'work'])
  await repo.write('specs/a.md', 'changed')
  await repo.write('other/c.md', 'also changed')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit'])

  const result = await changedPathsBetween({ cwd: repo.root, from: 'main', to: 'work', paths: ['specs'] })

  expect(result).toEqual({ ok: true, paths: ['specs/a.md'] })
})

// Requirement: Two revisions can be compared without checking either one out
// Scenario: Every path either revision holds is answered
// GIVEN a branch that added a file main never had and kept every file main holds
// WHEN every path either revision holds is asked for
// THEN the answer holds both the file only the branch has and the file both share
it('answers every path either revision holds', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': 'one' })
  await repo.git(['checkout', '-b', 'work'])
  await repo.write('specs/b.md', 'two')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'add'])

  const result = await pathsAtEither({ cwd: repo.root, a: 'main', b: 'work', paths: ['specs'] })

  expect(result).toEqual({ ok: true, paths: ['specs/a.md', 'specs/b.md'] })
})

// Requirement: Two revisions can be compared without checking either one out
// Scenario: Whether one revision is an ancestor of the other is answered both ways
// GIVEN a branch built straight off main with one commit of its own
// WHEN main is asked whether it is an ancestor of the branch, and the branch whether it is an
//      ancestor of main
// THEN the first answers true and the second answers false
it('answers ancestry both ways', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await repo.git(['checkout', '-b', 'work'])
  await repo.write('a.txt', 'b')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'on work'])

  const forward = await isAncestor({ cwd: repo.root, ancestor: 'main', descendant: 'work' })
  const backward = await isAncestor({ cwd: repo.root, ancestor: 'work', descendant: 'main' })

  expect(forward).toEqual({ ok: true, isAncestor: true })
  expect(backward).toEqual({ ok: true, isAncestor: false })
})

// Requirement: Two revisions can be compared without checking either one out
// Scenario: A revision the repository does not have is a refusal naming it
// GIVEN a repository with no revision named `ghost`
// WHEN the merge base of main and `ghost` is asked for
// THEN the answer is a refusal naming `ghost`
it('refuses a revision the repository does not have, naming it', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })

  const result = await mergeBase({ cwd: repo.root, a: 'main', b: 'ghost' })

  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toContain('ghost')
})
