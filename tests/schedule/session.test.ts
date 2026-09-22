// Capability: schedule

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { liveSessionCount, promptBodyFrom, reaperFor, resolveSessionWorktree, sessionStartFor, teardownTask, tmuxKillSessionCommand, tmuxListSessionsCommand, tmuxSessionCommands } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of the test body it belongs to — a thrown
// assertion earlier in that body would otherwise skip the delete and leak the override into
// every later test, exactly the kind of leaked ambient state this requirement exists to guard
// against. The same pattern `judge-cli.test.ts` already uses for its own env overrides.
afterEach(() => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  delete process.env.PROOFSPEC_EXECUTOR
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: The settled TASK's worktree is removed from its conventional path, freeing its branch for a later dispatch
// GIVEN a TASK with a worktree standing at its conventional path
// WHEN the settled TASK's teardown runs
// THEN nothing stands at that path, and the branch can be checked out in a fresh worktree again
it('removes the settled TASK\'s worktree and frees its branch for a later dispatch', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  await resolveSessionWorktree(repo.root, 'a')
  // The teardown kills a tmux session by the TASK's name; pointing it at a throwaway socket
  // keeps that kill from ever reaching a real session on the production socket.
  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run'

  await teardownTask(repo.root, 'a')

  await expect(readFile(join(repo.root, '.proofspec', 'worktrees', 'a', '.git'), 'utf8')).rejects.toThrow()
  // The collision the first unattended dispatch died on: a worktree registration left holding
  // the branch after its directory was gone. Re-adding must succeed without --force and
  // without a manual prune — that is what "freed" means here, not merely the empty path.
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'a'), 'work/a'])
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: The settled TASK's tmux session is killed on the dedicated server
// GIVEN a TASK the queue has settled, and a tmux session still carrying its name
// WHEN the settled TASK's teardown runs
// THEN the kill reaches the dedicated server by its -L socket, never the default one, and names the TASK's session
// The kill a teardown runs is the reaper's now, so the proof holds the reaper to account
// twice: by plan (which server, which session, both socket states) and by landing (a real
// session on a throwaway server dies within the reaper's delay of the teardown).
it('kills the settled TASK\'s tmux session on the dedicated server', async () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  expect(reaperFor('a').reapEnv).toEqual({
    PROOFSPEC_REAP_SECONDS: '2',
    PROOFSPEC_REAP_SOCKET: 'proofspec',
    PROOFSPEC_REAP_TASK: 'a',
  })
  expect(reaperFor('a').args).toEqual(['-c', expect.stringContaining('tmux -L "$PROOFSPEC_REAP_SOCKET" kill-session -t "$PROOFSPEC_REAP_TASK"')])

  const socket = 'proofspec-test-run-42'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  expect(reaperFor('a').reapEnv.PROOFSPEC_REAP_SOCKET).toBe(socket)

  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'settled-gone', { edit: 'a.txt' })
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'settled-gone'), 'work/settled-gone'])
  const tmux = (args: readonly string[]) => execFileAsync('tmux', ['-L', socket, ...args])
  await tmux(['new-session', '-d', '-s', 'settled-gone', 'sleep', '60'])
  const hasSession = () => tmux(['has-session', '-t', 'settled-gone']).then(() => true, () => false)
  try {
    await teardownTask(repo.root, 'settled-gone')
    await expect(hasSession()).resolves.toBe(true)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (await hasSession())) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await expect(hasSession()).resolves.toBe(false)
  } finally {
    await tmux(['kill-server']).catch(() => {})
  }
}, 10000)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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
        'Begin: work your TASK a now - read the MANIFEST\'s intentRef (the reserved name INTENT names the TASK\'s own queue entry file .proofspec/dispatch/a/INTENT; any other value names a file on this branch), then run the full pipeline through to merge.',
      ],
    },
  ])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The pi invocation disables extension auto-discovery, so the worktree's own copy of progress.ts never loads alongside the pinned one
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN the pi invocation carries --no-extensions, so only the pinned --extension path loads
it('disables extension auto-discovery so the worktree\'s own progress.ts never loads alongside the pinned one', () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  expect(start.args).toContain('--no-extensions')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The tmux commands run against a dedicated server, never the user's default or any other named one
// GIVEN the default socket name has not been overridden
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target the dedicated proofspec socket, not the user's default tmux server
it('runs against a dedicated tmux server, never the default one, unless overridden', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET

  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec'])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The pi invocation is handed one initial user message as its positional prompt argument, telling the session to begin working its TASK
// GIVEN a TASK ready to build
// WHEN the tmux start command is built
// THEN the pi invocation ends in a positional prompt argument — a non-empty message naming the TASK and telling the session to begin working it
it('hands pi one positional kickoff message telling the session to begin working its TASK', () => {
  const systemPrompt = 'you are the executor'
  const [, start] = tmuxSessionCommands('dispatch-me', { worktree: '/repo/.proofspec/worktrees/dispatch-me', queueRoot: '/repo', systemPrompt })

  // The arg before the kickoff is the --append-system-prompt value itself, so the last arg
  // cannot be filling any flag's slot — it can only be pi's positional prompt argument, the
  // one argument that makes an unattended session begin rather than sit at its input box.
  const kickoff = start.args[start.args.length - 1]
  expect(start.args[start.args.length - 2]).toBe(systemPrompt)
  expect(kickoff).not.toMatch(/^-/)
  expect(kickoff).toMatch(/begin/i)
  expect(kickoff).toContain('dispatch-me')
  // The message carries the intentRef's one resolution rule, both shapes: the reserved name
  // INTENT read from the TASK's own queue entry, and any other value read from the branch —
  // an executor whose TASK's intent stands only in its queue entry would otherwise be sent
  // looking for a file its branch does not hold.
  expect(kickoff).toContain('INTENT')
  expect(kickoff).toMatch(/queue entry/)
  expect(kickoff).toMatch(/branch/)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: With PROOFSPEC_EXECUTOR unset, or naming pi, the started harness is pi
// GIVEN PROOFSPEC_EXECUTOR unset, and then set to name pi
// WHEN the tmux commands to start a TASK's session are built
// THEN each time the start command's agent is the pi invocation — `pi` under the same
//      pinned argv the pi scenarios above carry
it('starts the pi invocation whenever PROOFSPEC_EXECUTOR is unset, and when it names pi', () => {
  // The same pinned slice the --approve/--extension scenario carries, checked once per
  // GIVEN case — the default must survive the harness choice being added, not silently
  // drift the moment the variable starts being read.
  const pinnedPiArgv = ['pi', '--approve', '--no-extensions', '--extension', '/repo/.pi/extensions/progress.ts']
  const build = () => tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })
  const agentArgv = (command: { args: readonly string[] }) => {
    const piIndex = command.args.indexOf('pi')
    return command.args.slice(piIndex, piIndex + 5)
  }

  delete process.env.PROOFSPEC_EXECUTOR
  expect(agentArgv(build()[1]!)).toEqual(pinnedPiArgv)

  process.env.PROOFSPEC_EXECUTOR = 'pi'
  expect(agentArgv(build()[1]!)).toEqual(pinnedPiArgv)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: PROOFSPEC_EXECUTOR naming claude starts the claude invocation: the executor's own system prompt appended, permissions skipped, and a generated MCP config naming the queue root's own MCP server
// GIVEN PROOFSPEC_EXECUTOR naming claude, a TASK, its worktree, and the queue root
// WHEN the tmux start command is built
// THEN the agent it starts is claude, run with `--append-system-prompt` carrying the
//      executor's own system prompt, with `--dangerously-skip-permissions`, and with a
//      generated MCP config naming the queue root's own MCP server
it('starts the claude invocation when PROOFSPEC_EXECUTOR names claude', async () => {
  const queueRoot = '/repo'
  process.env.PROOFSPEC_EXECUTOR = 'claude'

  const [, start] = tmuxSessionCommands('a', { worktree: `${queueRoot}/.proofspec/worktrees/a`, queueRoot, systemPrompt: 'you are the executor' })

  // The agent the start command runs is claude itself — a different harness, not pi with
  // claude's flags bolted onto it.
  expect(start.args.indexOf('claude')).toBeGreaterThan(-1)
  // Permissions skipped: an unattended session has nobody attached to answer an approval.
  expect(start.args).toContain('--dangerously-skip-permissions')
  // The flag immediately followed by exactly the executor's own system prompt — the same
  // value the SessionStart carries, the same way the pi invocation carries it.
  const systemPromptIndex = start.args.indexOf('--append-system-prompt')
  expect(systemPromptIndex).toBeGreaterThan(-1)
  expect(start.args[systemPromptIndex + 1]).toBe('you are the executor')
  // A generated MCP config naming the queue root's own MCP server. Which server the config
  // names is the promise; where the file sits is the implementation's choice — so the value
  // is read as inline JSON when it is JSON, and as a file otherwise, resolved against the
  // queue root wherever the implementation wrote it.
  const configIndex = start.args.indexOf('--mcp-config')
  expect(configIndex).toBeGreaterThan(-1)
  const carried = start.args[configIndex + 1]!
  const configText = carried.trimStart().startsWith('{') ? carried : await readFile(resolve(queueRoot, carried), 'utf8')
  const named = JSON.stringify(JSON.parse(configText))
  expect(named).toContain(queueRoot)
  expect(named).not.toContain(`${queueRoot}/.proofspec/worktrees`)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The claude invocation carries the same environment variables and the same positional kickoff message the pi one carries
// GIVEN PROOFSPEC_EXECUTOR naming claude
// WHEN the tmux start command is built
// THEN it carries `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK` as environment variables
//      naming the main checkout and the TASK, and ends in one positional kickoff message
//      telling the session to begin working its TASK
it('carries the same environment variables and the same positional kickoff message on the claude invocation', () => {
  process.env.PROOFSPEC_EXECUTOR = 'claude'

  const [, start] = tmuxSessionCommands('dispatch-me', { worktree: '/repo/.proofspec/worktrees/dispatch-me', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  // The claude invocation is the one being checked, so it must be the claude invocation —
  // under a builder that ignores PROOFSPEC_EXECUTOR these checks would pass by inspecting
  // pi's command instead, proving nothing about the harness this scenario names.
  expect(start.args.indexOf('claude')).toBeGreaterThan(-1)
  // The same slice at the flags' own position the pi scenario carries — each -e immediately
  // precedes the value it names, on the same tmux new-session command either harness runs.
  const envFlagIndex = start.args.indexOf('-c') + 2
  expect(start.args.slice(envFlagIndex, envFlagIndex + 4)).toEqual(['-e', 'PROOFSPEC_QUEUE_ROOT=/repo', '-e', 'PROOFSPEC_TASK=dispatch-me'])
  // One positional kickoff message, last on the command: not a flag itself, and not filling
  // either value-taking flag's slot — the exact words are the implementation's choice, the
  // message itself is not, because a session handed no first message never begins.
  const kickoff = start.args[start.args.length - 1]!
  expect(['--append-system-prompt', '--mcp-config']).not.toContain(start.args[start.args.length - 2])
  expect(kickoff).not.toMatch(/^-/)
  expect(kickoff).toMatch(/begin/i)
  expect(kickoff).toContain('dispatch-me')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target
// GIVEN PROOFSPEC_TMUX_SOCKET names a different socket
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target that socket instead of the default proofspec one
it('lets PROOFSPEC_TMUX_SOCKET override which dedicated server is targeted', () => {
  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'

  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', 'proofspec-test-run-42'])
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: The live count is asked of the dedicated server by its own -L socket, never the default server
// GIVEN the counting command a scheduling pass asks for the live session count
// WHEN it is built
// THEN it reaches tmux through -L on the dedicated server — the same socket the start commands
//      use, and the one PROOFSPEC_TMUX_SOCKET overrides — never the user's default server
it('asks the dedicated server for the live count by its own -L socket, never the default one', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  expect(tmuxListSessionsCommand()).toEqual({ command: 'tmux', args: ['-L', 'proofspec', 'list-sessions'] })

  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'
  expect(tmuxListSessionsCommand()).toEqual({ command: 'tmux', args: ['-L', 'proofspec-test-run-42', 'list-sessions'] })
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: The live count reads the sessions standing on the server itself, answering zero when none stand
// GIVEN a real throwaway tmux server holding two sessions, then one, then none at all
// WHEN the live session count is asked of it
// THEN it answers two, then one, then zero — the server's own list, taken fresh each call, with
//      no server standing reading as zero rather than a failure
it('reads the live count from the sessions standing on the server itself', async () => {
  const socket = 'proofspec-test-session-count'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  // A server can outlive a test that died mid-body, so its residue is cleared before the
  // sessions this test means to count are placed — counting is exact here or nothing is.
  const tmux = (args: readonly string[]) => execFileAsync('tmux', ['-L', socket, ...args])
  await tmux(['kill-server']).catch(() => {})
  try {
    // `sleep` keeps each session's process alive, so the session stands until killed below.
    await tmux(['new-session', '-d', '-s', 'one', 'sleep', '60'])
    await tmux(['new-session', '-d', '-s', 'two', 'sleep', '60'])

    await expect(liveSessionCount()).resolves.toBe(2)

    await tmux(['kill-session', '-t', 'one'])
    await expect(liveSessionCount()).resolves.toBe(1)

    await tmux(['kill-server'])
    await expect(liveSessionCount()).resolves.toBe(0)
  } finally {
    await tmux(['kill-server']).catch(() => {})
  }
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
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
