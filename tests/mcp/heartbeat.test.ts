// Capability: mcp

import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import progressExtension from '../../src/progress/extension.ts'
import { tmuxStartSession } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of the test body it belongs to — the same
// leaked-ambient-state guard `tests/progress/extension.test.ts` and `tests/schedule/`
// already keep. `PROOFSPEC_EXECUTOR` is the new variable this capability introduces, cleaned
// up the way the session tests clean their own overrides.
afterEach(() => {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
  delete process.env.PROOFSPEC_EXECUTOR
})

// --- driving the heartbeat CLI entry --------------------------------------------------

/** The heartbeat CLI entry's own source — under `src/mcp/`, where the intent puts it — run
 *  the same way the `proofspec` script runs `src/cli/main.ts`: a real process, not an
 *  imported function, because the entry's contract is what it does to the queue when the
 *  harness fires it, environment and all. */
const HEARTBEAT_ENTRY = fileURLToPath(new URL('../../src/mcp/heartbeat.ts', import.meta.url))

/** Where the entry ships inside a checkout of this product — the one repo-relative path a
 *  conforming hook command may name, pinned by the intent ("the heartbeat CLI entry under
 *  src/mcp/"). */
const SHIPPED_ENTRY_RELATIVE = relativePath(resolve(dirname(HEARTBEAT_ENTRY), '..', '..'), HEARTBEAT_ENTRY)

/** How one drive of the entry ended: its exit code, the stderr that names the cause in a
 *  failing assertion's message, and the throwaway working directory the entry ran in. */
type EntryRun = { readonly code: number | null; readonly stderr: string; readonly cwd: string }

/** Runs the heartbeat CLI entry as a real process under exactly the environment named and
 *  nothing else — no ambient variable can stand in for one the harness did not carry, which
 *  is the whole difference between "refused because unset" and "answered from the test
 *  runner's own environment". The process runs in a fresh throwaway directory, not the
 *  test runner's own cwd: an entry that wrongly falls back to its working directory for a
 *  missing variable writes there, and that directory is reported back so the walk can see
 *  it — "no heartbeat anywhere" cannot be satisfied by writing somewhere un-walked. */
function runHeartbeatEntry(env: Readonly<Record<string, string>>): Promise<EntryRun> {
  return new Promise(resolve => {
    mkdtemp(join(tmpdir(), 'proofspec-heartbeat-')).then(cwd => {
      const child = spawn(process.execPath, ['--experimental-transform-types', HEARTBEAT_ENTRY], {
        env: { ...env },
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
      child.once('error', error => resolve({ code: null, stderr: `${stderr}\n${String(error)}`, cwd }))
      child.once('exit', code => resolve({ code, stderr, cwd }))
    })
  })
}

// --- queue-entry fixtures -------------------------------------------------------------

/** Writes one file into a TASK's queue entry, the fixture shape every queue-holding test
 *  writes. */
async function writeEntryFile(entry: { readonly root: string; readonly task: string; readonly name: string; readonly bytes: string }): Promise<void> {
  const dir = join(entry.root, '.proofspec', 'dispatch', entry.task)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, entry.name), entry.bytes)
}

function heartbeatPath(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task, 'heartbeat')
}

/** Reads the TASK's heartbeat, or `undefined` while none exists — one shape that backs both
 *  "it was refreshed" and "it never appeared" without absence having to throw. */
async function readHeartbeat(root: string, task: string): Promise<string | undefined> {
  try {
    return await readFile(heartbeatPath(root, task), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** The shape the `pi` event's own write leaves — `new Date().toISOString()`, an ISO-8601
 *  instant with millisecond precision and a `Z` offset. "The same write" means the CLI entry
 *  leaves this same shape, so the `heartbeat` file means the same whichever trigger fired
 *  it. */
function isIsoInstant(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) && !Number.isNaN(Date.parse(text))
}

/** Every file named `heartbeat` anywhere under a root, by relative path — "no heartbeat is
 *  written anywhere" is a claim about the whole tree, not only the entry's own directory. */
async function findHeartbeats(root: string): Promise<readonly string[]> {
  const found: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      else if (entry.name === 'heartbeat') found.push(`${prefix}${entry.name}`)
    }
  }
  await walk(root, '')
  return found
}

/** One file of a TASK's queue entry as it stands: its bytes, and the moment they were last
 *  written — a rewrite of identical bytes is still a write, and "stands exactly as it was"
 *  promises neither. */
type Standing = { readonly bytes: string; readonly writtenAt: number }

/** Every file standing in a TASK's queue entry, by name — the whole of "everything else in
 *  the entry", so the only-the-heartbeat-changes claim is held to account against the entry
 *  as it stands, not against a list the test thought to name. */
async function entryStanding(root: string, task: string): Promise<ReadonlyMap<string, Standing>> {
  const dir = join(root, '.proofspec', 'dispatch', task)
  const standing = new Map<string, Standing>()
  for (const name of await readdir(dir)) {
    const info = await stat(join(dir, name))
    if (!info.isFile()) continue
    standing.set(name, { bytes: await readFile(join(dir, name), 'utf8'), writtenAt: info.mtimeMs })
  }
  return standing
}

// --- firing the pi transport's own write ----------------------------------------------

/** A handler the progress extension subscribed, with the per-event payloads this contract
 *  ignores stripped away — one shape so one Map can hold all six. */
type PiHandler = (event: never, ctx: ExtensionContext) => unknown

/** Registers the progress extension against a fake `ExtensionAPI` that records every
 *  subscription — the one way to fire a real observable-move event's real write without a
 *  session running. `registerTool` is accepted and ignored: the tools are the other limbs'
 *  concern. */
function registerProgress(): ReadonlyMap<string, PiHandler> {
  const handlers = new Map<string, PiHandler>()
  const pi = {
    on: (event: string, handler: PiHandler): void => {
      handlers.set(event, handler)
    },
    registerTool: (): void => {},
  }
  progressExtension(pi as unknown as ExtensionAPI)
  return handlers
}

/** Fires the handler subscribed to `event`. A missing subscription is itself the failure —
 *  thrown with the event named so the red run says what never arrived. */
async function fireObservableMove(handlers: ReadonlyMap<string, PiHandler>, event: string): Promise<void> {
  const handler = handlers.get(event)
  if (handler === undefined) throw new Error(`the progress extension subscribed no handler to ${event}`)
  await handler({} as never, {} as unknown as ExtensionContext)
}

// --- standing up a dispatched Claude Code session's hook wiring ----------------------

/** The events Claude Code reports a session's moves through — the hook-bearing counterparts
 *  of the `pi` transport's six observable moves. Which of them a dispatch wires is the
 *  wiring's own choice; that at least one move-bearing event carries a command hook that
 *  runs the heartbeat entry is not. */
const REPORTED_MOVE_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const

/** The command hook a settings object carries for an event the harness reports a move
 *  through, with that event's name — or nothing when the settings carry no such hook. */
function commandHookFrom(settings: unknown): { readonly event: string; readonly command: string } | undefined {
  if (typeof settings !== 'object' || settings === null) return undefined
  const hooks = (settings as { hooks?: Record<string, unknown> }).hooks
  if (typeof hooks !== 'object' || hooks === null) return undefined
  for (const event of REPORTED_MOVE_EVENTS) {
    const groups = hooks[event]
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (typeof group !== 'object' || group === null) continue
      const hookList = (group as { hooks?: unknown }).hooks
      if (!Array.isArray(hookList)) continue
      for (const hook of hookList) {
        if (typeof hook !== 'object' || hook === null) continue
        const command = (hook as { command?: unknown }).command
        if (typeof command === 'string' && command.trim() !== '') return { event, command }
      }
    }
  }
  return undefined
}

/** The first command hook, across every move-bearing event, whose command names the
 *  heartbeat CLI entry — a dispatch may wire other hooks to other events, and the entry's
 *  hook is the one this claim is about. */
function entryHookFrom(
  settings: unknown,
  session: { readonly worktree: string; readonly queueRoot: string },
): { readonly event: string; readonly command: string; readonly entryPath: string } | undefined {
  if (typeof settings !== 'object' || settings === null) return undefined
  const hooks = (settings as { hooks?: Record<string, unknown> }).hooks
  if (typeof hooks !== 'object' || hooks === null) return undefined
  for (const event of REPORTED_MOVE_EVENTS) {
    const groups = hooks[event]
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (typeof group !== 'object' || group === null) continue
      const hookList = (group as { hooks?: unknown }).hooks
      if (!Array.isArray(hookList)) continue
      for (const hook of hookList) {
        if (typeof hook !== 'object' || hook === null) continue
        const command = (hook as { command?: unknown }).command
        if (typeof command !== 'string' || command.trim() === '') continue
        const entryPath = namedEntryPath(command, session)
        if (entryPath !== undefined) return { event, command, entryPath }
      }
    }
  }
  return undefined
}

/** Whether `path` names something under `root` — the one path relation both "the config
 *  names the queue root's checkout" and "the entry the hook names belongs to the queue
 *  root" turn on. */
function sitsUnder(root: string, path: string): boolean {
  const relative = relativePath(root, path)
  return relative !== '' && !relative.startsWith('..') && !isAbsolute(relative)
}

/** The path of the heartbeat CLI entry a hook command names, resolved the way the shell
 *  that runs the command would resolve it — absolute tokens as they stand, relative tokens
 *  against the session's own working directory. The entry belongs under the queue root's
 *  checkout (the same freshness rule the MCP server carries), so only a token that both
 *  names the entry file (`mcp/heartbeat`) and sits under the queue root counts; the first
 *  such token wins, and none means the hook does not call the entry at all. */
function namedEntryPath(
  command: string,
  session: { readonly worktree: string; readonly queueRoot: string },
): string | undefined {
  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/^["']|["']$/g, '')
    if (!token.includes('mcp/heartbeat')) continue
    const resolved = isAbsolute(token) ? token : resolve(session.worktree, token)
    if (sitsUnder(session.queueRoot, resolved)) return resolved
  }
  return undefined
}

/** The session's `.claude/settings.json`, parsed, or nothing while none stands. */
async function readSettings(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Runs `action` with a stand-in `tmux` first on `PATH` — one that accepts every command and
 *  starts nothing. The dispatch's own start then runs for real (worktree, persona, commands
 *  built) while no server and no harness is ever started, so the wiring a dispatched session
 *  runs with is on disk to be read. The fake lives in a `makeRepo` directory, so
 *  `cleanupRepos` removes it; `PATH` is restored even when the action throws. */
async function withFakeTmux(action: () => Promise<void>): Promise<void> {
  const bin = await makeRepo({ tmux: '#!/bin/sh\nexit 0\n' })
  await chmod(join(bin.root, 'tmux'), 0o755)
  const previousPath = process.env.PATH
  process.env.PATH = `${bin.root}:${previousPath ?? ''}`
  try {
    await action()
  } finally {
    process.env.PATH = previousPath
  }
}

/** Fires one hook the way Claude Code fires its hooks: the settings' command line handed to
 *  a shell, run in the session's own working directory, with the event's payload on stdin
 *  and the session's environment — the same `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` pair a
 *  dispatched session's own start command carries. */
function fireHook(firing: {
  readonly worktree: string
  readonly event: string
  readonly command: string
  readonly session: { readonly queueRoot: string; readonly task: string }
}): Promise<EntryRun> {
  return new Promise(resolve => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.PROOFSPEC_QUEUE_ROOT
    delete env.PROOFSPEC_TASK
    env.PROOFSPEC_QUEUE_ROOT = firing.session.queueRoot
    env.PROOFSPEC_TASK = firing.session.task
    const child = spawn('sh', ['-c', firing.command], { cwd: firing.worktree, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', error => resolve({ code: null, stderr: `${stderr}\n${String(error)}`, cwd: firing.worktree }))
    child.once('exit', code => resolve({ code, stderr, cwd: firing.worktree }))
    child.stdin.end(
      JSON.stringify({ hook_event_name: firing.event, session_id: 'proofspec-test', transcript_path: '', cwd: firing.worktree, tool_name: 'Bash', tool_input: {} }),
    )
  })
}

// --- the claims -----------------------------------------------------------------------

// Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks
// Scenario: The heartbeat CLI entry performs the same heartbeat write the pi events trigger
// GIVEN the environment naming a TASK's queue entry, and the heartbeat a pi observable-move event writes into it
// WHEN the heartbeat CLI entry runs with the same environment
// THEN it performs the same write — the heartbeat file in that entry is refreshed, its content the same shape the event-triggered write leaves
it('performs the same heartbeat write into the TASK\'s entry that the pi events trigger', async () => {
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'queued' })
  // The pi transport's own write, fired for real: the environment names the entry exactly
  // the way a dispatched session's would, and one observable-move event runs its handler.
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  await fireObservableMove(registerProgress(), 'turn_start')

  const eventHeartbeat = await readHeartbeat(repo.root, 'a')
  expect(eventHeartbeat, 'the pi event wrote no heartbeat to hold the shape against').toBeDefined()
  // Deleting the event's heartbeat before the CLI runs is what proves the CLI's write stands
  // on its own — the same trick the progress transport's own proof uses per event.
  await rm(heartbeatPath(repo.root, 'a'), { force: true })

  const run = await runHeartbeatEntry({ PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' })

  // The run itself, established before its effects are read — a process that died on import
  // performed no write whose shape could be checked.
  expect(run.code, `the heartbeat CLI entry did not run: ${run.stderr.trim()}`).toBe(0)
  const entryHeartbeat = await readHeartbeat(repo.root, 'a')
  expect(entryHeartbeat, 'the heartbeat CLI entry refreshed no heartbeat in the entry').toBeDefined()
  expect(eventHeartbeat !== undefined && isIsoInstant(eventHeartbeat), 'the pi event\'s heartbeat is not an ISO instant').toBe(true)
  expect(
    entryHeartbeat !== undefined && isIsoInstant(entryHeartbeat),
    `the CLI's heartbeat ${JSON.stringify(entryHeartbeat)} is not the shape the pi event's write leaves`,
  ).toBe(true)
})

// Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks
// Scenario: The heartbeat CLI entry writes nothing when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset
// GIVEN first PROOFSPEC_QUEUE_ROOT, then PROOFSPEC_TASK, unset in the environment
// WHEN the heartbeat CLI entry runs
// THEN no heartbeat is written anywhere
it('writes no heartbeat anywhere when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset', async () => {
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'queued' })

  for (const missing of ['PROOFSPEC_QUEUE_ROOT', 'PROOFSPEC_TASK'] as const) {
    const env: Record<string, string> = { PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' }
    delete env[missing]
    const run = await runHeartbeatEntry(env)
    // The run is established before "nothing was written" is read — an entry that cannot run
    // at all would leave that nothing true vacuously. A clean exit is the no-op's own shape:
    // the pi trigger swallows the unset case silently, and a hook fired on every move must
    // not fail the session for it.
    expect(run.code, `the heartbeat CLI entry did not run with ${missing} unset: ${run.stderr.trim()}`).toBe(0)
    // "Anywhere" includes the entry's own working directory: a wrong entry falls back to
    // its cwd for the missing variable, and the spawned cwd is a throwaway directory the
    // walk then covers — a fallback write cannot hide outside the walked roots.
    expect(await findHeartbeats(repo.root), `a heartbeat was written with ${missing} unset`).toEqual([])
    expect(await findHeartbeats(run.cwd), `a heartbeat was written under the entry's own working directory with ${missing} unset`).toEqual([])
  }
})

// Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks
// Scenario: The heartbeat CLI entry does nothing else
// GIVEN a TASK's queue entry carrying its state, MANIFEST, LEASE, and phase standing
// WHEN the heartbeat CLI entry runs
// THEN only the heartbeat file changes — everything else in the entry stands exactly as it was
it('changes only the heartbeat file, leaving the rest of the entry exactly as it was', async () => {
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{"branch":"work/a"}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'LEASE', bytes: '2026-01-01T00:00:00.000Z' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'phase', bytes: '{"phase":"tests-red","round":1,"since":1700000000000}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'phase-history', bytes: '{"phase":"tests-red","round":1,"since":1700000000000}\n' })
  const before = await entryStanding(repo.root, 'a')

  const run = await runHeartbeatEntry({ PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' })

  expect(run.code, `the heartbeat CLI entry did not run: ${run.stderr.trim()}`).toBe(0)
  const after = await entryStanding(repo.root, 'a')
  expect([...after.keys()].sort(), 'the entry changed more than its heartbeat file').toEqual([...before.keys(), 'heartbeat'].sort())
  for (const [name, was] of before) {
    const now = after.get(name)
    expect(now, `${name} vanished from the entry`).toBeDefined()
    expect(now?.bytes, `${name} was rewritten`).toBe(was.bytes)
    expect(now?.writtenAt, `${name} was rewritten`).toBe(was.writtenAt)
  }
  const heartbeat = await readHeartbeat(repo.root, 'a')
  expect(heartbeat !== undefined && isIsoInstant(heartbeat), 'the heartbeat file the entry gained is not an ISO instant').toBe(true)
})

// Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks
// Scenario: The Claude Code hooks run the heartbeat CLI entry on the session's moves, refreshing the TASK's heartbeat
// GIVEN the environment naming a TASK's queue entry, and a Claude Code executor session started for that TASK the way this product's dispatch starts one
// WHEN the session makes a move the harness reports
// THEN the hooks the harness fires on that move run the heartbeat CLI entry, and the TASK's heartbeat is refreshed in its queue entry
// No live `claude` run: the dispatch's own start stands the wiring up with only the terminal
// multiplexer stood in for, one reported move is driven the way the harness drives its hooks,
// and the heartbeat is read.
it('runs the heartbeat CLI entry from the Claude Code hooks on a reported move, refreshing the TASK\'s heartbeat', async () => {
  const repo = await makeGitRepo({
    'a.txt': 'a',
    '.pi/agents/executor.md': '---\nname: executor\ntools: []\n---\nYou are the executor persona.\n',
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  process.env.PROOFSPEC_EXECUTOR = 'claude'

  await withFakeTmux(() => tmuxStartSession(repo.root, 'a'))

  const worktree = join(repo.root, '.proofspec', 'worktrees', 'a')
  const settingsPath = join(worktree, '.claude', 'settings.json')
  const settings = await readSettings(settingsPath)
  expect(settings, `the dispatched Claude Code session carries no hooks config at ${settingsPath}`).toBeDefined()
  const anyHook = settings === undefined ? undefined : commandHookFrom(settings)
  expect(anyHook, 'no hook is wired to any event the harness reports a move through').toBeDefined()
  const hook = settings === undefined ? undefined : entryHookFrom(settings, { worktree, queueRoot: repo.root })
  expect(hook, 'no move-bearing hook runs the heartbeat CLI entry').toBeDefined()
  if (anyHook === undefined || hook === undefined) return

  // The STANDARD's own sentence is "the Claude Code harness's hooks call it" — the hook
  // must run the heartbeat CLI entry itself, not refresh a heartbeat by its own means. So
  // the command has to name the entry file at the location this product ships it (the same
  // repo-relative path the real entry holds here), and that file — planted from this repo's
  // real entry — is what runs when the hook fires. A command that writes an instant by its
  // own means, or names an entry-shaped path where no file will ever ship, fails here.
  expect(
    relativePath(repo.root, hook.entryPath),
    `the hook names the entry at a path this product does not ship (${hook.command})`,
  ).toBe(SHIPPED_ENTRY_RELATIVE)
  await mkdir(dirname(hook.entryPath), { recursive: true })
  await copyFile(HEARTBEAT_ENTRY, hook.entryPath)

  const fired = await fireHook({ worktree, event: hook.event, command: hook.command, session: { queueRoot: repo.root, task: 'a' } })

  const heartbeat = await readHeartbeat(repo.root, 'a')
  expect(
    heartbeat !== undefined && isIsoInstant(heartbeat),
    `the hook the harness fires on a reported move refreshed no heartbeat in the TASK's queue entry (exited ${fired.code}: ${fired.stderr.trim()})`,
  ).toBe(true)
}, 20000)
