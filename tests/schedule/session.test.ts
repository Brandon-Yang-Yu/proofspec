// Capability: schedule

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { liveSessionCount, promptBodyFrom, reaperFor, resolveSessionWorktree, sessionStartFor, teardownTask, tmuxKillSessionCommand, tmuxListSessionsCommand, tmuxSessionCommands } from '../../src/cli/session.ts'
import type { TmuxCommand } from '../../src/cli/session.ts'
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
  delete process.env.PROOFSPEC_BASE_BRANCH
})

/** The default socket name the STANDARD derives from a queue root's absolute path —
 *  `proofspec-` plus the first 8 hex digits of that path's SHA-256 digest. Each proof below
 *  computes it from that rule itself, so what is asserted is the derivation, never one
 *  implementation's spelling of it. */
function derivedSocketFor(queueRoot: string): string {
  return `proofspec-${createHash('sha256').update(queueRoot).digest('hex').slice(0, 8)}`
}

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

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in the BASE_BRANCH
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

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in the BASE_BRANCH
// Scenario: The settled TASK's tmux session is killed on the dedicated server
// GIVEN a TASK the queue has settled, and a tmux session still carrying its name
// WHEN the settled TASK's teardown runs
// THEN the kill reaches the dedicated server by its -L socket, never the default one, and names the TASK's session
// The kill a teardown runs is the reaper's now, so the proof holds the reaper to account
// twice: by plan (which server, which session, both socket states) and by landing (a real
// session on a throwaway server dies within the reaper's delay of the teardown).
it('kills the settled TASK\'s tmux session on the dedicated server', async () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  // The reaper is built from a queue root, and the socket it resolves is that root's own
  // derived default — the same rule the start commands use, so a settle's kill lands on
  // the very server the session it kills was started on.
  expect(reaperFor('a', '/repo').reapEnv).toEqual({
    PROOFSPEC_REAP_SECONDS: '2',
    PROOFSPEC_REAP_SOCKET: derivedSocketFor('/repo'),
    PROOFSPEC_REAP_TASK: 'a',
  })
  expect(reaperFor('a', '/repo').args).toEqual(['-c', expect.stringContaining('tmux -L "$PROOFSPEC_REAP_SOCKET" kill-session -t "$PROOFSPEC_REAP_TASK"')])

  const socket = 'proofspec-test-run-42'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  expect(reaperFor('a', '/repo').reapEnv.PROOFSPEC_REAP_SOCKET).toBe(socket)

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

// The start command's own command words are `sh <runner script path>` — pi's whole
// invocation, with every flag and text it needs, lives in that script's content, so every
// promise below about pi's own argv is read from the file those words name.
async function runnerScriptFrom(start: TmuxCommand): Promise<string> {
  const scriptPath = start.args[start.args.indexOf('sh') + 1]
  expect(scriptPath).toBeDefined()
  return readFile(scriptPath!, 'utf8')
}

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi
// GIVEN a tmux session already named for the TASK
// WHEN the tmux commands to start its session are built
// THEN the first kills that stale session, and the second starts a fresh one running pi
//      under the same name, in the TASK's own worktree, detached
it('kills a stale tmux session by the TASK\'s name before starting a fresh one running pi', async () => {
  const [kill, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  expect(kill).toEqual({ command: 'tmux', args: ['-L', derivedSocketFor('/repo'), 'kill-session', '-t', 'a'] })
  // The fresh session carries the same name as the stale one just killed — the pair replaces
  // a dead session rather than colliding with it — and its command words are nothing but the
  // runner script, so "running pi" is read from that script's own content.
  const nameIndex = start.args.indexOf('-s')
  expect(start.args[nameIndex + 1]).toBe('a')
  // Detached, so the fresh session stands with no client attached to the scheduling pass
  // that started it; and its working directory is the TASK's own worktree — the flag that
  // sets a new session's directory, immediately followed by the worktree the build was
  // handed, never the directory the builder itself ran in.
  expect(start.args).toContain('-d')
  const worktreeDirIndex = start.args.indexOf('-c')
  expect(start.args[worktreeDirIndex + 1]).toBe('/repo/.proofspec/worktrees/a')
  await expect(runnerScriptFrom(start)).resolves.toMatch(/^exec pi\b/)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The tmux start command carries PROOFSPEC_QUEUE_ROOT, PROOFSPEC_TASK, and PROOFSPEC_BASE_BRANCH as environment variables naming the main checkout, the TASK, and the base branch its queue measures against
// GIVEN a ready TASK whose queue measures against a BASE_BRANCH other than main
// WHEN the tmux start command is built
// THEN it hands the session the queue's checkout, the TASK's name, and that branch as
//      environment variables, so a session that settles measures against the same branch
//      its queue was built on
it('carries PROOFSPEC_QUEUE_ROOT, PROOFSPEC_TASK, and PROOFSPEC_BASE_BRANCH as environment variables on the start command', () => {
  process.env.PROOFSPEC_BASE_BRANCH = 'bDev'
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // Pairwise scans, not a positional slice — the STANDARD and the CLAIM name three
  // variables without ordering them, and a flag appended after another -e (KICKOFF,
  // say) still satisfies them. Each scan proves some -e immediately precedes the value
  // it names.
  const carries = (value: string): boolean => {
    for (let i = 0; i + 1 < start.args.length; i++) {
      if (start.args[i] === '-e' && start.args[i + 1] === value) return true
    }
    return false
  }
  expect(carries('PROOFSPEC_QUEUE_ROOT=/repo')).toBe(true)
  expect(carries('PROOFSPEC_TASK=a')).toBe(true)
  expect(carries('PROOFSPEC_BASE_BRANCH=bDev')).toBe(true)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The pi invocation carries --approve and --extension pinned twice over — this checkout's own progress extension, and the subagent extension inside the installed pi package
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN the pi invocation carries --approve, and pins two extensions by path: this checkout's
//      own progress extension, and the subagent extension shipped inside the pi package
//      under the queue root's node_modules — never a file under .pi/extensions/, so the
//      extension and the pi that runs it cannot drift apart
it('carries --approve and --extension pinned twice over — this checkout\'s own progress extension, and the subagent extension inside the installed pi package', async () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })
  const words = (await runnerScriptFrom(start)).trim().split(' ')

  // Slices at the flags' own positions in pi's invocation, not arrayContaining — proves
  // --approve immediately follows pi and each --extension is immediately followed by
  // exactly an environment variable, never a path spelled out inside the script itself.
  const piIndex = words.indexOf('pi')
  expect(words.slice(piIndex, piIndex + 2)).toEqual(['pi', '--approve'])
  const extensionIndex = words.indexOf('--extension')
  expect(words.slice(extensionIndex, extensionIndex + 2)).toEqual(['--extension', '"$PROOFSPEC_PROGRESS_EXTENSION"'])
  const subagentIndex = words.indexOf('--extension', extensionIndex + 1)
  expect(words.slice(subagentIndex, subagentIndex + 2)).toEqual(['--extension', '"$PROOFSPEC_SUBAGENT_EXTENSION"'])
  // The values those variables receive are what pin the two extensions — one -e
  // environment entry each on the start command (the flag immediately before its value),
  // resolved from the queue root, not from whatever the TASK's branch carries.
  const extensionEnvIndex = start.args.indexOf('PROOFSPEC_PROGRESS_EXTENSION=/repo/.pi/extensions/progress.ts')
  expect(extensionEnvIndex).toBeGreaterThan(0)
  expect(start.args[extensionEnvIndex - 1]).toBe('-e')
  const subagentExtensionPath = '/repo/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts'
  const subagentEnvIndex = start.args.indexOf(`PROOFSPEC_SUBAGENT_EXTENSION=${subagentExtensionPath}`)
  expect(subagentEnvIndex).toBeGreaterThan(0)
  expect(start.args[subagentEnvIndex - 1]).toBe('-e')
  // The exact-equality env pin above carries the never-clause on its own: a value under
  // .pi/extensions/ - a wrapper, say - is a different string and fails the equality, so
  // the pin can only ever name the subagent example inside the installed pi package.
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The pi invocation disables extension auto-discovery, so the worktree's own copy of progress.ts never loads alongside the pinned one
// GIVEN a TASK and its worktree
// WHEN the tmux start command is built
// THEN the pi invocation carries --no-extensions, so only the pinned --extension path loads
it('disables extension auto-discovery so the worktree\'s own progress.ts never loads alongside the pinned one', async () => {
  const [, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // The flag lives in pi's own invocation inside the runner script — auto-discovery is what
  // would load the worktree's own copy of the extension beside the pinned ones.
  await expect(runnerScriptFrom(start)).resolves.toContain('--no-extensions')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: pi receives the system prompt and kickoff exactly as passed, whatever shell metacharacters their texts carry
// GIVEN a system prompt at the executor persona's own scale, whose text carries shell metacharacters
// WHEN the tmux start command runs on a real tmux server and the session's pi starts
// THEN pi is handed the system prompt and the kickoff exactly as passed — one argument each, same bytes, no substitution, no redirection, no word-splitting
it('hands pi the system prompt and kickoff exactly as passed, whatever shell metacharacters they carry', async () => {
  // A pi of this test's own on a throwaway PATH slot: it answers the one question this scenario
  // turns on — the exact argv pi itself was handed — and nothing else. The path is baked into the
  // script rather than passed by environment: the whole point is to observe what survives the
  // trip through tmux, and an environment variable is one more thing that trip could lose.
  const base = await mkdtemp(join(tmpdir(), 'proofspec-session-handoff-'))
  const argvFile = join(base, 'argv.json')
  await mkdir(join(base, 'worktree'))
  await writeFile(join(base, 'pi'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))
`)
  await chmod(join(base, 'pi'), 0o755)
  const socket = 'proofspec-test-shell-handoff'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  // The PATH reaches the session's pi through the server, which a fresh socket starts from
  // this very client — hence the kill-server first, so no older server with an older PATH answers.
  const env = { ...process.env, PATH: `${base}:${process.env.PATH}` }
  const tmux = (args: readonly string[]) => execFileAsync('tmux', ['-L', socket, ...args], { env })
  await tmux(['kill-server']).catch(() => {})
  try {
    const paragraph = [
      'You are the executor. Measure the digest before you build anything:',
      '`git diff --name-only "$(git merge-base HEAD <base>)" HEAD -- specs/` - the MANIFEST',
      "names the base. Quotes are text here, both 'single' and \"double\", as are | pipes, & ampersands,",
      '; semicolons, $(git rev-parse HEAD) substitutions, ${HOME} expansions, `backticks`, and the',
      'redirections <in and >out that a shell would otherwise act on.',
    ].join('\n')
    // Persona scale, not a token handful: tmux packs the command words it is handed and refuses
    // ones past its own size cap, so a prompt shorter than the real persona would pass this
    // test where the dispatch it stands for still dies.
    const systemPrompt = Array.from({ length: 50 }, () => paragraph).join('\n\n')
    const [, start] = tmuxSessionCommands('a', { worktree: join(base, 'worktree'), queueRoot: base, systemPrompt })
    let tmuxFailure = ''
    try {
      await execFileAsync(start.command, [...start.args], { env })
    } catch (error) {
      const failureInfo = error as { code?: number; stderr?: string }
      tmuxFailure = `tmux exited ${failureInfo.code ?? '?'}: ${(failureInfo.stderr ?? '').trim()}`
    }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !existsSync(argvFile)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(existsSync(argvFile), `pi never ran (${tmuxFailure || 'tmux exited 0 without starting it'})`).toBe(true)
    expect(JSON.parse(await readFile(argvFile, 'utf8'))).toEqual([
      '--approve', '--no-extensions', '--extension', join(base, '.pi', 'extensions', 'progress.ts'),
      '--extension', join(base, 'node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'subagent', 'index.ts'),
      '--append-system-prompt', systemPrompt,
      "Begin: work your TASK a now - read the MANIFEST's intentRef (the reserved name INTENT names the TASK's own queue entry file .proofspec/dispatch/a/INTENT; any other value names a file on this branch), then run the full pipeline through to merge.",
    ])
  } finally {
    await tmux(['kill-server']).catch(() => {})
    await rm(base, { recursive: true, force: true })
  }
}, 15000)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: With PROOFSPEC_EXECUTOR unset, or naming pi, the started harness is pi
// GIVEN PROOFSPEC_EXECUTOR unset, and then set to name pi
// WHEN the tmux commands to start a TASK's session are built
// THEN each time the start command's agent is the pi invocation — and naming pi builds the
//      same invocation the unset choice builds
it('starts the pi invocation whenever PROOFSPEC_EXECUTOR is unset, and when it names pi', async () => {
  const build = () => tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // Each GIVEN case built and read on its own — the default must survive the harness choice
  // being added, not silently drift the moment the variable starts being read. Naming pi
  // must reach the same invocation, not a pi-shaped shortcut: the pi-named build's runner
  // script is the unset build's own script, byte for byte — pins included, since the
  // scenarios above prove what the unset build's script carries.
  delete process.env.PROOFSPEC_EXECUTOR
  const unsetScript = await runnerScriptFrom(build()[1])
  await expect(unsetScript).toMatch(/^exec pi\b/)
  expect(build()[1].args.join('\n')).not.toContain('PROOFSPEC_MCP_CONFIG')

  process.env.PROOFSPEC_EXECUTOR = 'pi'
  const namedPiScript = await runnerScriptFrom(build()[1])
  await expect(namedPiScript).toMatch(/^exec pi\b/)
  expect(build()[1].args.join('\n')).not.toContain('PROOFSPEC_MCP_CONFIG')
  expect(namedPiScript, 'naming pi must carry the unset build\'s own pinned runner script').toBe(unsetScript)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: PROOFSPEC_EXECUTOR naming claude starts the claude invocation: the executor's own system prompt appended, permissions skipped, and a generated MCP config naming the queue root's own MCP server
// GIVEN PROOFSPEC_EXECUTOR naming claude, a TASK, its worktree, and the queue root
// WHEN the tmux start command is built
// THEN the agent it starts is claude, run with `--append-system-prompt` carrying the
//      executor's own system prompt, with `--dangerously-skip-permissions`, and with a
//      generated MCP config naming the queue root's own MCP server
it('starts the claude invocation when PROOFSPEC_EXECUTOR names claude', async () => {
  process.env.PROOFSPEC_EXECUTOR = 'claude'
  const queueRoot = '/repo'

  const [, start] = tmuxSessionCommands('a', { worktree: `${queueRoot}/.proofspec/worktrees/a`, queueRoot, systemPrompt: 'you are the executor' })

  // The agent the runner script starts is claude itself — a different harness, not pi with
  // claude's flags bolted onto it.
  const script = await runnerScriptFrom(start)
  expect(script).toMatch(/^exec claude\b/)
  // Permissions skipped: an unattended session has nobody attached to answer an approval.
  expect(script).toContain('--dangerously-skip-permissions')
  // The persona rides the same prompt file the pi runner reads — same bytes, one argument,
  // whatever metacharacters the persona carries (the scenario above proves the trip). The
  // start command must carry the file's path beside it, and the file must hold the persona
  // itself: without either, the runner's $(cat …) expands to nothing and claude starts with
  // an empty persona while every other check stays green.
  expect(script).toContain('--append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")"')
  const promptEnvIndex = start.args.findIndex(arg => arg.startsWith('PROOFSPEC_SYSTEM_PROMPT_FILE='))
  expect(promptEnvIndex, 'the start command carries no prompt file path in its environment').toBeGreaterThan(-1)
  expect(start.args[promptEnvIndex - 1]).toBe('-e')
  await expect(readFile(start.args[promptEnvIndex]!.slice('PROOFSPEC_SYSTEM_PROMPT_FILE='.length), 'utf8')).resolves.toBe('you are the executor')
  // And the runner hands the config to claude: the flag names the same environment entry the
  // start command carries — a config written and carried but never loaded leaves the session
  // without the five tools, and nothing downstream would notice.
  expect(script).toContain('--mcp-config "$PROOFSPEC_MCP_CONFIG"')
  // A generated MCP config naming the queue root's own MCP server. Which server the config
  // names is the promise; where the file sits is the implementation's choice — so the config
  // is read from the path the environment names.
  const configIndex = start.args.findIndex(arg => arg.startsWith('PROOFSPEC_MCP_CONFIG='))
  expect(configIndex, 'the start command carries no MCP config path in its environment').toBeGreaterThan(-1)
  expect(start.args[configIndex - 1]).toBe('-e')
  const configPath = start.args[configIndex]!.slice('PROOFSPEC_MCP_CONFIG='.length)
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> }
  // Which server the config names is the promise, so identity is asserted, not just
  // location: the one server it names is the queue root's own MCP server — the stdio
  // server entry this checkout ships, `src/mcp/serve.ts` under the queue root. A config
  // naming a different entry, or a second server beside the real one, is a different
  // answer than the one claimed.
  const entries = Object.entries(config.mcpServers ?? {})
  expect(entries.length, 'the config must name exactly one MCP server').toBe(1)
  for (const [, server] of entries) {
    const words = [server.command, ...(Array.isArray(server.args) ? server.args : [])]
      .filter((word): word is string => typeof word === 'string')
    expect(
      words,
      `the server the config names is not the queue root's own MCP server entry`,
    ).toContain(join(queueRoot, 'src', 'mcp', 'serve.ts'))
    const paths = words.filter(word => word.includes('/'))
    expect(
      paths.some(path => sitsUnderPath(queueRoot, path)),
      `no path in ${JSON.stringify(words)} names the queue root's own server`,
    ).toBe(true)
    expect(
      paths.every(path => !sitsUnderPath(`${queueRoot}/.proofspec/worktrees`, path)),
      `a path in ${JSON.stringify(words)} names the TASK's worktree, not the queue root`,
    ).toBe(true)
  }
})

/** Whether `path` names something strictly under `root` — path tokens are read as they
 *  stand, the way a harness reading its config would hold an absolute one. */
function sitsUnderPath(root: string, path: string): boolean {
  return path.startsWith(`${root}/`) && path.slice(root.length + 1) !== ''
}

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The claude invocation carries the same environment variables and the same positional kickoff message the pi one carries
// GIVEN PROOFSPEC_EXECUTOR naming claude
// WHEN the tmux start command is built
// THEN it carries `PROOFSPEC_QUEUE_ROOT`, `PROOFSPEC_TASK`, and `PROOFSPEC_BASE_BRANCH` as
//      environment variables naming the main checkout, the TASK, and the base branch its
//      queue measures against, and hands claude one positional kickoff message telling the
//      session to begin working its TASK
it('carries the same environment variables and the same positional kickoff message on the claude invocation', async () => {
  process.env.PROOFSPEC_EXECUTOR = 'claude'
  process.env.PROOFSPEC_BASE_BRANCH = 'bDev'

  const [, start] = tmuxSessionCommands('dispatch-me', { worktree: '/repo/.proofspec/worktrees/dispatch-me', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  // The same pairwise scans the pi scenario carries — each -e immediately precedes the value
  // it names, on the same tmux new-session command either harness runs, with no ordering
  // assumed between the entries. The base branch is named the way the pi proof names it, so
  // its -e pair is expected beside the other two.
  const carries = (value: string): boolean => {
    for (let i = 0; i + 1 < start.args.length; i++) {
      if (start.args[i] === '-e' && start.args[i + 1] === value) return true
    }
    return false
  }
  expect(carries('PROOFSPEC_QUEUE_ROOT=/repo')).toBe(true)
  expect(carries('PROOFSPEC_TASK=dispatch-me')).toBe(true)
  expect(carries('PROOFSPEC_BASE_BRANCH=bDev')).toBe(true)
  // The kickoff rides the same environment entry the pi runner reads, and the claude runner
  // hands it to claude as the one positional prompt argument, leading every flag. An
  // unattended session handed no first message never begins working its TASK. The same
  // message, read literally: the claude build's kickoff is the pi build's kickoff, byte
  // for byte.
  delete process.env.PROOFSPEC_EXECUTOR
  const piKickoff = tmuxSessionCommands('dispatch-me', { worktree: '/repo/.proofspec/worktrees/dispatch-me', queueRoot: '/repo', systemPrompt: 'you are the executor' })[1].args.find(arg => arg.startsWith('PROOFSPEC_KICKOFF='))
  process.env.PROOFSPEC_EXECUTOR = 'claude'
  const kickoffEnvIndex = start.args.findIndex(arg => arg.startsWith('PROOFSPEC_KICKOFF='))
  expect(kickoffEnvIndex).toBeGreaterThan(-1)
  expect(start.args[kickoffEnvIndex - 1]).toBe('-e')
  expect(start.args[kickoffEnvIndex]).toBe(piKickoff)
  expect(piKickoff).toMatch(/begin/i)
  expect(piKickoff).toContain('intentRef')
  const script = await runnerScriptFrom(start)
  // The kickoff is claude's one positional prompt argument, leading the flags — `--mcp-config`
  // takes space-separated values, so a trailing positional after it would be read as one
  // more config path and the session would die before starting (the acceptance run caught
  // exactly that). Exactly one occurrence of the kickoff reference: a bad merge that kept a
  // trailing copy beside the new lead would pass every other check and die live.
  expect(script.trim().startsWith('exec claude "$PROOFSPEC_KICKOFF"')).toBe(true)
  expect(script.split('PROOFSPEC_KICKOFF').length - 1, 'the kickoff must appear exactly once in the claude runner').toBe(1)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The tmux commands run against a dedicated server whose name is derived from the queue root, never the user's default or any other named one
// GIVEN the default socket name has not been overridden, and a TASK whose session starts under a queue root whose absolute path is known
// WHEN the tmux commands to start its session are built
// THEN both commands reach tmux through -L on the socket derived from that path — proofspec-
//      followed by the first 8 hex digits of the path's SHA-256 digest — never the user's
//      default tmux server, and never a fixed name every repo on the machine would share
it('runs against a dedicated tmux server derived from the queue root, never the default one', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET

  const commands = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: '' })

  // The expected name is computed from the queue root by the STANDARD's own rule — never a
  // literal — so any fixed name every repo on the machine would share fails the equality.
  const socket = derivedSocketFor('/repo')
  for (const command of commands) expect(command.args.slice(0, 2)).toEqual(['-L', socket])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: The pi invocation is handed one initial user message as its positional prompt argument, telling the session to begin working its TASK
// GIVEN a TASK ready to build
// WHEN the tmux start command is built
// THEN the pi invocation ends in a positional prompt argument — a non-empty message naming the TASK and telling the session to begin working it
it('hands pi one positional kickoff message telling the session to begin working its TASK', async () => {
  const [, start] = tmuxSessionCommands('dispatch-me', { worktree: '/repo/.proofspec/worktrees/dispatch-me', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  // The kickoff text rides PROOFSPEC_KICKOFF verbatim — everything after the variable name
  // in the -e entry is the message itself, never a mangled or truncated stand-in.
  const envEntry = start.args.find(arg => arg.startsWith('PROOFSPEC_KICKOFF='))
  expect(envEntry).toBeDefined()
  const kickoff = envEntry!.slice('PROOFSPEC_KICKOFF='.length)
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
  // And the runner script hands exactly that variable to pi as its last word — after every
  // flag/value pair, quoted so it expands to one argument — the one slot pi reads as its
  // positional prompt, the argument that makes an unattended session begin rather than sit
  // at its input box.
  const words = (await runnerScriptFrom(start)).trim().split(' ')
  expect(words[words.length - 1]).toBe('"$PROOFSPEC_KICKOFF"')
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed
// Scenario: PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target
// GIVEN PROOFSPEC_TMUX_SOCKET names a different socket
// WHEN the tmux commands to start a TASK's session are built
// THEN both commands target that socket instead of the derived default
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
  // Built from a queue root, targeting that root's own derived default — the same socket the
  // start commands use, so what is counted is what this tool started, repo by repo.
  expect(tmuxListSessionsCommand('/repo')).toEqual({ command: 'tmux', args: ['-L', derivedSocketFor('/repo'), 'list-sessions'] })

  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'
  expect(tmuxListSessionsCommand('/repo')).toEqual({ command: 'tmux', args: ['-L', 'proofspec-test-run-42', 'list-sessions'] })
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
