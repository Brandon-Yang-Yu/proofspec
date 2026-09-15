// Capability: schedule

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { promptBodyFrom, resolveSessionWorktree, tmuxSessionCommands } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of the test body it belongs to — a thrown
// assertion earlier in that body would otherwise skip the delete and leak the override into
// every later test, exactly the kind of leaked ambient state this requirement exists to guard
// against. The same pattern `judge-cli.test.ts` already uses for its own env overrides.
afterEach(() => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
})

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
  const commands = tmuxSessionCommands('a', '/repo/.proofspec/worktrees/a', 'you are the executor')

  expect(commands).toEqual([
    { command: 'tmux', args: ['-L', 'proofspec', 'kill-session', '-t', 'a'] },
    {
      command: 'tmux',
      args: [
        '-L', 'proofspec', 'new-session', '-d', '-s', 'a', '-c', '/repo/.proofspec/worktrees/a', 'pi',
        '--append-system-prompt', 'you are the executor',
      ],
    },
  ])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The tmux commands run against a dedicated server, never the user's default or any other named one
// GIVEN the default socket name has not been overridden
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target the dedicated proofspec socket, not the user's default tmux server
it('runs against a dedicated tmux server, never the default one, unless overridden', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET

  const commands = tmuxSessionCommands('a', '/repo/.proofspec/worktrees/a', '')

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target
// GIVEN PROOFSPEC_TMUX_SOCKET names a different socket
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target that socket instead of the default proofspec one
it('lets PROOFSPEC_TMUX_SOCKET override which dedicated server is targeted', () => {
  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'

  const commands = tmuxSessionCommands('a', '/repo/.proofspec/worktrees/a', '')

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec-test-run-42'])
})

// Requirement: startSession seeds the executor session with the executor's own system prompt
// Scenario: The executor persona's YAML frontmatter is stripped before it is used as a system prompt
// GIVEN the executor persona file's raw contents, frontmatter included
// WHEN its prompt body is extracted
// THEN the frontmatter is gone and only the prose body remains
it('strips the executor persona\'s YAML frontmatter before using it as a system prompt', () => {
  const raw = '---\nname: executor\ntools: read, write\n---\n\nYou are the **executor**.\n'

  expect(promptBodyFrom(raw)).toBe('You are the **executor**.')
})

// Requirement: startSession seeds the executor session with the executor's own system prompt
// Scenario: A persona file with no frontmatter passes through unchanged
// GIVEN a persona file with no YAML frontmatter at all
// WHEN its prompt body is extracted
// THEN the whole file, trimmed, is returned unchanged
it('passes a persona file with no frontmatter through unchanged, trimmed', () => {
  const raw = '\nYou are the **executor**.\n\n'

  expect(promptBodyFrom(raw)).toBe('You are the **executor**.')
})
