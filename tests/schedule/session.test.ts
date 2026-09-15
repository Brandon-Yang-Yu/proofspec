// Capability: schedule

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveSessionWorktree, tmuxSessionCommands } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: A ready TASK whose worktree has never been checked out gets one created at its conventional path
// GIVEN a ready TASK whose worktree has never been checked out
// WHEN startSession runs
// THEN a worktree for that TASK's branch is created at its conventional path
it('creates a worktree at the TASK\'s conventional path when none has ever been checked out', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })

  const worktree = await resolveSessionWorktree(repo.root, 'a')

  expect(worktree).toBe(`${repo.root}/.proofspec/worktrees/a`)
  expect(await repo.git(['-C', worktree, 'branch', '--show-current'])).toBe('work/a')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: A ready TASK whose worktree already exists at its conventional path has it reused, not recreated
// GIVEN a ready TASK whose worktree already exists at its conventional path
// WHEN startSession runs
// THEN the existing worktree is reused, not recreated
it('reuses a TASK\'s worktree once it already exists, rather than recreating it', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  const firstCall = await resolveSessionWorktree(repo.root, 'a')
  // Recreating the worktree (`git worktree remove` + `git worktree add`) would wipe an
  // untracked file sitting in it — this is what actually distinguishes "reused unchanged"
  // from "destroyed and rebuilt to the same end state", which a plain end-state check cannot.
  await writeFile(join(firstCall, 'untracked-marker.txt'), 'still here')

  const worktree = await resolveSessionWorktree(repo.root, 'a')

  expect(worktree).toBe(firstCall)
  await expect(readFile(join(worktree, 'untracked-marker.txt'), 'utf8')).resolves.toBe('still here')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi
// GIVEN a tmux session already named for the TASK
// WHEN the tmux commands to start its session are built
// THEN the first kills that stale session, and the second starts a fresh one running pi under the same name
it('kills a stale tmux session by the TASK\'s name before starting a fresh one running pi', () => {
  const commands = tmuxSessionCommands('a', '/repo/.proofspec/worktrees/a')

  expect(commands).toEqual([
    { command: 'tmux', args: ['kill-session', '-t', 'a'] },
    { command: 'tmux', args: ['new-session', '-d', '-s', 'a', '-c', '/repo/.proofspec/worktrees/a', 'pi'] },
  ])
})
