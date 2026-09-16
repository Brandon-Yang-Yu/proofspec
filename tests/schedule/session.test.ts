// Capability: schedule

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { promptBodyFrom, resolveSessionWorktree, sessionStartFor, tmuxSessionCommands } from '../../src/cli/session.ts'
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
// Scenario: A directory merely sitting at the TASK's conventional path is not reused, a worktree is created instead
// GIVEN a TASK whose conventional path holds an empty directory with no .git file at its root
// WHEN startSession runs
// THEN a worktree for that TASK's branch is created at that path, not the empty directory reused
it('treats a directory merely sitting at the conventional path as no worktree, creating one there instead', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // The residue a failed `git worktree add` can leave behind: a directory at the path, but
  // no repository behind it — reusing it would start the session where no work can happen,
  // on every retry, with no failure to report.
  await mkdir(join(repo.root, '.proofspec', 'worktrees', 'a'), { recursive: true })

  const worktree = await resolveSessionWorktree(repo.root, 'a')

  expect(worktree).toBe(`${repo.root}/.proofspec/worktrees/a`)
  expect(await repo.git(['-C', worktree, 'branch', '--show-current'])).toBe('work/a')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: A worktree creation that fails throws an error carrying git's own stderr
// GIVEN a TASK whose branch is already checked out in another worktree, so git worktree add refuses
// WHEN startSession runs
// THEN it throws an error carrying git's own stderr in its message, not a bare could-not-create summary
it('throws an error carrying git\'s own stderr when creating the worktree fails', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // The one real way creation fails: the branch already checked out in another worktree.
  await repo.git(['worktree', 'add', join(repo.root, 'elsewhere'), 'work/a'])

  // git's fatal line is its own stderr, wording only git writes — matching it proves the
  // message carries stderr itself, which a bare summary naming no cause never could.
  await expect(resolveSessionWorktree(repo.root, 'a')).rejects.toThrow(
    /fatal: 'work\/a' is already (used by worktree|checked out at)/,
  )
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi
// GIVEN a tmux session already named for the TASK
// WHEN the tmux commands to start its session are built
// THEN the first kills that stale session, and the second starts a fresh one running pi under the same name
it('kills a stale tmux session by the TASK\'s name before starting a fresh one running pi', () => {
  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  expect(commands).toEqual([
    { command: 'tmux', args: ['-L', 'proofspec', 'kill-session', '-t', 'a'] },
    {
      command: 'tmux',
      args: [
        '-L', 'proofspec', 'new-session', '-d', '-s', 'a', '-c', '/repo/.proofspec/worktrees/a',
        '-e', 'PROOFSPEC_QUEUE_ROOT=/repo', '-e', 'PROOFSPEC_TASK=a',
        'pi', '--approve', '--no-extensions', '--extension', '/repo/.pi/extensions/progress.ts',
        '--append-system-prompt', 'you are the executor',
      ],
    },
  ])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The tmux start command carries PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK as environment variables naming the main checkout and the TASK
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN it carries PROOFSPEC_QUEUE_ROOT naming the main checkout and PROOFSPEC_TASK naming the TASK
it('carries PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK as environment variables on the start command', () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // A slice at the flags' own position, not arrayContaining — proves each -e immediately
  // precedes the value it names, not just that all four tokens appear somewhere in args.
  const envFlagIndex = start.args.indexOf('-c') + 2
  expect(start.args.slice(envFlagIndex, envFlagIndex + 4)).toEqual(['-e', 'PROOFSPEC_QUEUE_ROOT=/repo', '-e', 'PROOFSPEC_TASK=a'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The pi invocation carries --approve and --extension pinned to this checkout's own progress extension
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN the pi invocation carries --approve and --extension pinned to this checkout's own progress extension
it('carries --approve and --extension pinned to this checkout\'s own progress extension', () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // A slice starting at 'pi' itself, not arrayContaining — proves --approve immediately
  // follows pi and --extension is immediately followed by exactly this path, not merely that
  // all five tokens appear somewhere in args.
  const piIndex = start.args.indexOf('pi')
  expect(start.args.slice(piIndex, piIndex + 5)).toEqual(['pi', '--approve', '--no-extensions', '--extension', '/repo/.pi/extensions/progress.ts'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The pi invocation disables extension auto-discovery, so the worktree's own copy of progress.ts never loads alongside the pinned one
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN the pi invocation carries --no-extensions, so only the pinned --extension path loads
it('disables extension auto-discovery so the worktree\'s own progress.ts never loads alongside the pinned one', () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  expect(start.args).toContain('--no-extensions')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: The tmux commands run against a dedicated server, never the user's default or any other named one
// GIVEN the default socket name has not been overridden
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target the dedicated proofspec socket, not the user's default tmux server
it('runs against a dedicated tmux server, never the default one, unless overridden', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET

  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target
// GIVEN PROOFSPEC_TMUX_SOCKET names a different socket
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target that socket instead of the default proofspec one
it('lets PROOFSPEC_TMUX_SOCKET override which dedicated server is targeted', () => {
  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'

  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec-test-run-42'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed
// Scenario: startSession's own cwd becomes the SessionStart's queueRoot, distinct from the TASK's worktree
// GIVEN startSession's own cwd and a TASK's worktree path
// WHEN the SessionStart is built
// THEN its queueRoot is startSession's own cwd, not the worktree
it('builds the SessionStart with startSession\'s own cwd as queueRoot, distinct from the worktree', () => {
  const start = sessionStartFor('/repo', '/repo/.proofspec/worktrees/a', 'you are the executor')

  expect(start).toEqual({ worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: 'you are the executor' })
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
