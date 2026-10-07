// Capability: mcp

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { tmuxStartSession } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of a test body — the same leaked-ambient-state
// guard the heartbeat entry's tests keep for the same two variables.
afterEach(() => {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
})

// --- the entry and the error the hook hands it ----------------------------------------

/** The provider-error CLI entry's own source — beside the heartbeat entry under `src/mcp/`,
 *  its model — run as a real process, because the entry's contract is what it does to the
 *  queue when the harness's hook fires it, environment and stdin and all. */
const PROVIDER_ERROR_ENTRY = fileURLToPath(new URL('../../src/mcp/provider-error.ts', import.meta.url))

/** Where the entry ships inside a checkout of this product — the repo-relative path the
 *  hook names when the queue root is that checkout. */
const CHECKOUT_ROOT = resolve(dirname(PROVIDER_ERROR_ENTRY), '..', '..')
const CHECKOUT_ENTRY_RELATIVE = relativePath(CHECKOUT_ROOT, PROVIDER_ERROR_ENTRY)

/** This checkout's own package.json, read once: the fixture checkout mirrors its module
 *  type so a checkout-run entry resolves its imports as it would here. */
const CHECKOUT_PACKAGE = JSON.parse(await readFile(join(CHECKOUT_ROOT, 'package.json'), 'utf8')) as { readonly type?: string }

/** Where an installed ProofSpec package ships the built provider-error entry — the sibling
 *  of the built heartbeat entry, named when the queue root is a project that installed
 *  ProofSpec. */
const INSTALLED_ENTRY_RELATIVE = join('node_modules', 'proofspec', 'dist', 'mcp', 'provider-error.js')

/** The provider's own error, as a quota-exhausted provider answered the TASK that motivated
 *  this entry. Quotes, colons, and braces are kept on purpose: "verbatim" is exactly what a
 *  re-encoding or a summary would break. */
const PROVIDER_ERROR = '429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-28 20:16:01"}'

/** The stdin payload Claude Code hands a `StopFailure` hook (read off the installed 2.1.283
 *  harness): the common hook fields, `error` — a category, not the provider's words —
 *  `error_details` carrying the provider's error, and the turn's last assistant text, which
 *  quotes it again behind a harness prefix. `error_details` is the field that carries the
 *  provider's error exactly as the provider gave it, so it is the error "as handed": the
 *  prefixed copy in the last assistant text is not. */
function stopFailurePayload(cwd: string): string {
  return JSON.stringify({
    session_id: 'proofspec-test',
    transcript_path: '',
    cwd,
    hook_event_name: 'StopFailure',
    error: 'rate_limit',
    error_details: PROVIDER_ERROR,
    last_assistant_message: `API Error: ${PROVIDER_ERROR}`,
  })
}

/** How one run ended: its exit code, the stderr that names the cause in a failing
 *  assertion's message, and the working directory it ran in. */
type EntryRun = { readonly code: number | null; readonly stderr: string; readonly cwd: string }

/** Runs a command line the way the harness runs a hook's — handed to a shell, in `cwd`, under
 *  exactly the environment named plus `PATH`, the `StopFailure` payload on stdin. No other
 *  ambient variable can stand in for one the harness did not carry, which is the whole
 *  difference between "refused because unset" and "answered from the test runner's own
 *  environment". */
function runHook(hook: { readonly command: string; readonly cwd: string; readonly env: Readonly<Record<string, string>> }): Promise<EntryRun> {
  return new Promise(resolve => {
    const child = spawn('sh', ['-c', hook.command], {
      cwd: hook.cwd,
      env: { PATH: process.env.PATH ?? '', ...hook.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', error => resolve({ code: null, stderr: `${stderr}\n${String(error)}`, cwd: hook.cwd }))
    child.once('exit', code => resolve({ code, stderr, cwd: hook.cwd }))
    child.stdin.end(stopFailurePayload(hook.cwd))
  })
}

/** Runs this checkout's own provider-error entry directly, in a fresh throwaway directory: an
 *  entry that wrongly falls back to its working directory for a missing variable writes
 *  there, and that directory is reported back so "nothing anywhere" can walk it. */
async function runEntry(env: Readonly<Record<string, string>>): Promise<EntryRun> {
  const cwd = await mkdtemp(join(tmpdir(), 'proofspec-provider-error-'))
  return runHook({ command: `node --experimental-transform-types ${PROVIDER_ERROR_ENTRY}`, cwd, env })
}

/** The variable naming where the write-order probe logs, set only for the probed run. */
const WRITE_ORDER_LOG_VARIABLE = 'PROOFSPEC_TEST_STATE_WRITE_LOG'

/** A `node --import` preload that wraps every public `fs` and `fs/promises` function able to
 *  put bytes at a path — direct writes, opens for writing, and the destination of a rename,
 *  copy, or link, so an atomic temp-then-rename write is seen at the rename that lands it.
 *  At the instant any of them is called on the TASK's `state`, it reads QUESTION off disk
 *  synchronously and logs what stood there (`null` when nothing did). The ESM named exports
 *  are re-synced so `import { writeFile } from 'node:fs/promises'` reaches the wrappers too. */
const WRITE_ORDER_PROBE = `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const log = process.env.${WRITE_ORDER_LOG_VARIABLE}
const queueRoot = process.env.PROOFSPEC_QUEUE_ROOT
const task = process.env.PROOFSPEC_TASK
if (log !== undefined && queueRoot !== undefined && task !== undefined) {
  // Directories compare by real path, so an entry that canonicalises the queue root still
  // matches (macOS temp dirs sit under the /var -> /private/var symlink); a directory that
  // does not exist keeps its resolved form.
  const realpathNow = fs.realpathSync.bind(fs)
  const canonicalDir = dir => { try { return realpathNow(dir) } catch { return resolve(dir) } }
  const entry = canonicalDir(resolve(queueRoot, '.proofspec', 'dispatch', task))
  const statePath = join(entry, 'state')
  const questionPath = join(entry, 'QUESTION')
  const appendLog = fs.appendFileSync.bind(fs)
  const readNow = fs.readFileSync.bind(fs)
  const toPath = target =>
    typeof target === 'string' ? target
      : target instanceof URL ? fileURLToPath(target)
      : Buffer.isBuffer(target) ? target.toString()
      : undefined
  const observe = target => {
    const path = toPath(target)
    if (path === undefined) return
    const absolute = resolve(path)
    if (join(canonicalDir(dirname(absolute)), basename(absolute)) !== statePath) return
    let question = null
    try { question = readNow(questionPath, 'utf8') } catch {}
    appendLog(log, JSON.stringify({ question }) + '\\n')
  }
  const opensForWriting = flags =>
    typeof flags === 'string' ? /[wa+]/.test(flags)
      : typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0
      : false
  const wrap = (owner, name, targetIndex, applies) => {
    const original = owner[name]
    if (typeof original !== 'function') return
    owner[name] = function (...args) {
      if (applies === undefined || applies(args)) observe(args[targetIndex])
      return original.apply(this, args)
    }
  }
  for (const owner of [fs, fs.promises]) {
    for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'truncate', 'truncateSync', 'createWriteStream']) wrap(owner, name, 0)
    for (const name of ['rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'link', 'linkSync', 'symlink', 'symlinkSync']) wrap(owner, name, 1)
    for (const name of ['open', 'openSync']) wrap(owner, name, 0, args => opensForWriting(args[1]))
  }
  syncBuiltinESMExports()
}
`

/** Every write to `state` the probe saw, in order, each with what QUESTION held at that
 *  instant — none when the log was never written. */
async function readStateWrites(log: string): Promise<readonly { readonly question: string | null }[]> {
  let text: string
  try {
    text = await readFile(log, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return text.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { readonly question: string | null })
}

// --- queue-entry fixtures -------------------------------------------------------------

function entryDir(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task)
}

async function writeEntryFile(entry: { readonly root: string; readonly task: string; readonly name: string; readonly bytes: string }): Promise<void> {
  await mkdir(entryDir(entry.root, entry.task), { recursive: true })
  await writeFile(join(entryDir(entry.root, entry.task), entry.name), entry.bytes)
}

/** Reads one file of a TASK's queue entry, or `undefined` while none exists — one shape that
 *  backs both "it carries the error" and "it never appeared" without absence throwing. */
async function readEntryFile(entry: { readonly root: string; readonly task: string; readonly name: string }): Promise<string | undefined> {
  try {
    return await readFile(join(entryDir(entry.root, entry.task), entry.name), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Every file named `name` anywhere under a root, by relative path — "no QUESTION is written
 *  anywhere" is a claim about the whole tree, not only the TASK's own entry. */
async function findFiles(root: string, name: string): Promise<readonly string[]> {
  const found: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      else if (entry.name === name) found.push(`${prefix}${entry.name}`)
    }
  }
  await walk(root, '')
  return found
}

// --- standing up a dispatched Claude Code session's hook wiring ----------------------

/** Every command the settings' hooks run for one event, in order. */
function hookCommands(settings: unknown, event: string): readonly string[] {
  if (typeof settings !== 'object' || settings === null) return []
  const hooks = (settings as { hooks?: unknown }).hooks
  if (typeof hooks !== 'object' || hooks === null) return []
  const groups = (hooks as Record<string, unknown>)[event]
  if (!Array.isArray(groups)) return []
  const commands: string[] = []
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue
    const hookList = (group as { hooks?: unknown }).hooks
    if (!Array.isArray(hookList)) continue
    for (const hook of hookList) {
      const command = typeof hook === 'object' && hook !== null ? (hook as { command?: unknown }).command : undefined
      if (typeof command === 'string') commands.push(command)
    }
  }
  return commands
}

/** The first `StopFailure` hook command naming the provider-error entry, with the entry path
 *  it names resolved the way the shell that runs it would — absolute tokens as they stand,
 *  relative ones against the session's own working directory. Any token naming the entry
 *  counts, wherever it points: where it points is what the claims then pin. */
function providerErrorHook(settings: unknown, worktree: string): { readonly command: string; readonly entryPath: string } | undefined {
  for (const command of hookCommands(settings, 'StopFailure')) {
    for (const raw of command.split(/\s+/)) {
      const token = raw.replace(/^["']|["']$/g, '')
      if (!token.includes('mcp/provider-error')) continue
      return { command, entryPath: isAbsolute(token) ? token : resolve(worktree, token) }
    }
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

/** Runs `action` with a stand-in `tmux` first on `PATH` that accepts every command and starts
 *  nothing: the dispatch's own start runs for real (worktree, persona, hook wiring) while no
 *  harness is ever started, so the wiring is on disk to be read. `PATH` is restored even when
 *  the action throws. */
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

const EXECUTOR_PERSONA = '---\nname: executor\ntools: []\n---\nYou are the executor persona.\n'

/** A built-JavaScript stand-in for the entry an installed package ships: the same park the
 *  real entry performs, run by plain `node`. The real entry's own behavior is proven by the
 *  direct-run scenarios below; this stand-in proves what only the installed path can — that
 *  the hook runs the file an install puts there. */
const BUILT_ENTRY_STANDIN = `import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
let input = ''
for await (const chunk of process.stdin) input += chunk
const queueRoot = process.env.PROOFSPEC_QUEUE_ROOT
const task = process.env.PROOFSPEC_TASK
if (queueRoot !== undefined && task !== undefined) {
  const entry = join(queueRoot, '.proofspec', 'dispatch', task)
  await writeFile(join(entry, 'QUESTION'), JSON.parse(input).error_details)
  await writeFile(join(entry, 'state'), 'blocked-on-question')
}
`

// --- the claims -----------------------------------------------------------------------

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: The provider-error entry writes the provider error verbatim into the TASK's QUESTION file and parks the TASK at blocked-on-question
// GIVEN PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK naming a TASK whose state word is building, and a provider error handed to the entry the way the hook hands it
// WHEN the provider-error entry runs
// THEN the TASK's queue entry's QUESTION file carries that provider error exactly as handed, and the TASK's state word is blocked-on-question
it('writes the provider error verbatim into the TASK\'s QUESTION file and parks the TASK at blocked-on-question', async () => {
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })

  const run = await runEntry({ PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' })

  // The run is established before its effects are read — a process that died on import
  // parked nothing whose shape could be checked.
  expect(run.code, `the provider-error entry did not run: ${run.stderr.trim()}`).toBe(0)
  const question = await readEntryFile({ root: repo.root, task: 'a', name: 'QUESTION' })
  expect(question, 'the entry wrote no QUESTION into the TASK\'s queue entry').toBeDefined()
  // Exactly, not "somewhere inside": a QUESTION that wraps, prefixes, or re-encodes the
  // error is not the error as handed.
  expect(question, 'the QUESTION is not the provider error exactly as the hook handed it').toBe(PROVIDER_ERROR)
  expect(await readEntryFile({ root: repo.root, task: 'a', name: 'state' }), 'the TASK was not parked').toBe('blocked-on-question')
})

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: The QUESTION file is written before the state word
// GIVEN PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK naming a TASK whose state word is building, and a provider error handed to the entry
// WHEN the provider-error entry writes the state word blocked-on-question
// THEN the queue entry's QUESTION file already carries the provider error at that moment
it('has the provider error standing in QUESTION by the time it writes the state word', async () => {
  // The probe reads QUESTION off disk at the instant each write to `state` begins, so the
  // order is observed, not inferred: a state-first entry, a "write state, catch, then
  // QUESTION" entry, and a `Promise.all` of both writes each reach `state` before QUESTION's
  // write has landed. Whether the run exits cleanly is no part of this claim, so it is not read.
  const probe = await makeRepo({ 'write-order-probe.mjs': WRITE_ORDER_PROBE })
  const log = join(probe.root, 'state-writes.jsonl')
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })

  const run = await runHook({
    command: `node --import ${join(probe.root, 'write-order-probe.mjs')} --experimental-transform-types ${PROVIDER_ERROR_ENTRY}`,
    cwd: probe.root,
    env: { PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a', [WRITE_ORDER_LOG_VARIABLE]: log },
  })

  const stateWrites = await readStateWrites(log)
  expect(stateWrites.length, `the entry never wrote the state word (exited ${run.code}: ${run.stderr.trim()})`).toBeGreaterThan(0)
  for (const write of stateWrites) {
    expect(write.question, 'no QUESTION stood when the state word was written').not.toBeNull()
    expect(write.question, 'the QUESTION standing at the state write does not carry the provider error').toContain(PROVIDER_ERROR)
  }
})

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: The provider-error entry writes nothing when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset
// GIVEN a provider error handed to the entry, with PROOFSPEC_QUEUE_ROOT unset, and then with PROOFSPEC_TASK unset
// WHEN the provider-error entry runs
// THEN each time no QUESTION file and no state word is written anywhere
it('writes no QUESTION and no state word anywhere when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset', async () => {
  const repo = await makeRepo({})
  await writeEntryFile({ root: repo.root, task: 'a', name: 'MANIFEST', bytes: '{}' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })
  const statePath = join(entryDir(repo.root, 'a'), 'state')
  const stateWrittenAt = (await stat(statePath)).mtimeMs

  for (const missing of ['PROOFSPEC_QUEUE_ROOT', 'PROOFSPEC_TASK'] as const) {
    const env: Record<string, string> = { PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' }
    delete env[missing]
    const run = await runEntry(env)
    // Established before "nothing was written" is read — an entry that cannot run at all
    // would leave that nothing true vacuously. A clean exit is the no-op's own shape, the
    // same one the heartbeat entry gives for the same unset case.
    expect(run.code, `the provider-error entry did not run with ${missing} unset: ${run.stderr.trim()}`).toBe(0)
    // "Anywhere" includes the entry's own working directory, a throwaway the walk covers, so
    // a fallback write cannot hide outside the walked roots.
    for (const root of [repo.root, run.cwd]) {
      expect(await findFiles(root, 'QUESTION'), `a QUESTION was written under ${root} with ${missing} unset`).toEqual([])
    }
    expect(await findFiles(run.cwd, 'state'), `a state word was written under the entry's own working directory with ${missing} unset`).toEqual([])
    expect(await findFiles(repo.root, 'state'), `a state word was written elsewhere under the queue root with ${missing} unset`).toEqual(['.proofspec/dispatch/a/state'])
    expect(await readFile(statePath, 'utf8'), `the TASK's state word changed with ${missing} unset`).toBe('building')
    expect((await stat(statePath)).mtimeMs, `the TASK's state word was rewritten with ${missing} unset`).toBe(stateWrittenAt)
  }
})

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: When the queue root is ProofSpec's own checkout, the StopFailure hook runs that checkout's own provider-error source and parks the TASK
// GIVEN a Claude Code executor session dispatched from a queue root that is ProofSpec's own checkout
// WHEN the hook wired on StopFailure fires for a turn that ended on a provider error
// THEN it runs the queue root's own source of the provider-error entry, never a copy inside the TASK's worktree, and the TASK is parked: the error in QUESTION, the state word blocked-on-question
it('runs the checkout\'s own provider-error source from the StopFailure hook when the queue root is ProofSpec\'s own checkout, parking the TASK', async () => {
  // No live `claude` run: the dispatch's own start stands the wiring up with only tmux stood
  // in for, and the StopFailure hook is fired the way the harness fires it.
  // Pinned as ProofSpec's own checkout by its package.json name, the one fact the entry
  // choice reads; the module type is mirrored so the planted source runs as it does here.
  const repo = await makeGitRepo({
    'a.txt': 'a',
    'package.json': `${JSON.stringify({ name: 'proofspec', type: CHECKOUT_PACKAGE.type }, null, 2)}\n`,
    '.pi/agents/executor.md': EXECUTOR_PERSONA,
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // A Claude Code session: the TASK's executor record names claude.
  await writeEntryFile({ root: repo.root, task: 'a', name: 'executor', bytes: 'claude' })

  await withFakeTmux(() => tmuxStartSession(repo.root, 'a'))

  const worktree = join(repo.root, '.proofspec', 'worktrees', 'a')
  const settings = await readSettings(join(worktree, '.claude', 'settings.json'))
  const hook = providerErrorHook(settings, worktree)
  expect(hook, `no StopFailure hook runs the provider-error entry (StopFailure runs ${JSON.stringify(hookCommands(settings, 'StopFailure'))})`).toBeDefined()
  if (hook === undefined) return
  // The queue root's own source, exactly — a path inside the worktree (which itself sits
  // under the queue root) is a different path and fails here.
  expect(hook.entryPath, `the StopFailure hook runs ${hook.command}, not the queue root's own source`).toBe(join(repo.root, CHECKOUT_ENTRY_RELATIVE))

  // The fixture checkout holds no source tree of its own, so this checkout's whole src/ tree
  // is planted at the queue root — not the entry file alone, since a correct entry may import
  // its siblings. The worktree gets no copy: a hook naming a worktree copy has nothing to
  // run. Node resolves a symlinked file's imports from its real path, so the planted source
  // finds its packages wherever this checkout's own source does; node_modules is planted
  // beside it only for a runner that keeps symlinked paths as given.
  await symlink(join(CHECKOUT_ROOT, 'src'), join(repo.root, 'src'), 'dir')
  await symlink(join(CHECKOUT_ROOT, 'node_modules'), join(repo.root, 'node_modules'), 'dir')
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })

  const fired = await runHook({ command: hook.command, cwd: worktree, env: { PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' } })

  const question = await readEntryFile({ root: repo.root, task: 'a', name: 'QUESTION' })
  expect(question, `the fired StopFailure hook wrote no QUESTION (exited ${fired.code}: ${fired.stderr.trim()})`).toContain(PROVIDER_ERROR)
  expect(await readEntryFile({ root: repo.root, task: 'a', name: 'state' }), 'the fired StopFailure hook did not park the TASK').toBe('blocked-on-question')
}, 20000)

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: When the queue root is a project that installed ProofSpec, the StopFailure hook runs the installed package's built provider-error entry and parks the TASK
// GIVEN a Claude Code executor session dispatched from a queue root that is a project that installed ProofSpec
// WHEN the hook wired on StopFailure fires for a turn that ended on a provider error
// THEN it runs the installed package's built copy of the provider-error entry under the queue root, never a copy inside the TASK's worktree, and the TASK is parked: the error in QUESTION, the state word blocked-on-question
it('runs the installed package\'s built provider-error entry from the StopFailure hook when the queue root installed ProofSpec, parking the TASK', async () => {
  // No package.json names `proofspec`: the queue root is a project that installed it.
  const repo = await makeGitRepo({
    'a.txt': 'a',
    '.pi/agents/executor.md': EXECUTOR_PERSONA,
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // A Claude Code session: the TASK's executor record names claude.
  await writeEntryFile({ root: repo.root, task: 'a', name: 'executor', bytes: 'claude' })

  await withFakeTmux(() => tmuxStartSession(repo.root, 'a'))

  const worktree = join(repo.root, '.proofspec', 'worktrees', 'a')
  const settings = await readSettings(join(worktree, '.claude', 'settings.json'))
  const hook = providerErrorHook(settings, worktree)
  expect(hook, `no StopFailure hook runs the provider-error entry (StopFailure runs ${JSON.stringify(hookCommands(settings, 'StopFailure'))})`).toBeDefined()
  if (hook === undefined) return
  expect(hook.entryPath, `the StopFailure hook runs ${hook.command}, not the installed package's built entry under the queue root`).toBe(join(repo.root, INSTALLED_ENTRY_RELATIVE))

  // A build output this repo's tests never assume stands, so a stand-in performing the same
  // park is planted at the installed path, beside the package.json an install ships that
  // marks the package ESM. A hook that parks by any other means, or names a path where
  // nothing runnable ships, fails here.
  await mkdir(dirname(hook.entryPath), { recursive: true })
  await writeFile(hook.entryPath, BUILT_ENTRY_STANDIN)
  await writeFile(join(repo.root, 'node_modules', 'proofspec', 'package.json'), `${JSON.stringify({ name: 'proofspec', type: 'module' }, null, 2)}\n`)
  await writeEntryFile({ root: repo.root, task: 'a', name: 'state', bytes: 'building' })

  const fired = await runHook({ command: hook.command, cwd: worktree, env: { PROOFSPEC_QUEUE_ROOT: repo.root, PROOFSPEC_TASK: 'a' } })

  const question = await readEntryFile({ root: repo.root, task: 'a', name: 'QUESTION' })
  expect(question, `the fired StopFailure hook wrote no QUESTION (exited ${fired.code}: ${fired.stderr.trim()})`).toContain(PROVIDER_ERROR)
  expect(await readEntryFile({ root: repo.root, task: 'a', name: 'state' }), 'the fired StopFailure hook did not park the TASK').toBe('blocked-on-question')
}, 20000)

// Requirement: A provider-error CLI entry parks the TASK, called by the Claude Code hook for a turn that stopped on a provider error
// Scenario: A TASK moved to claude by its executor record gets the StopFailure hook on every start
// GIVEN a TASK whose queue entry's executor record names claude, and no settings file naming an executor
// WHEN the TASK's session is started through the bare CLI's startSession
// THEN the TASK's worktree's Claude Code settings wire the provider-error entry on the StopFailure event
it('wires the provider-error entry on StopFailure for a TASK its executor record moved to claude', async () => {
  const repo = await makeGitRepo({
    'a.txt': 'a',
    '.pi/agents/executor.md': EXECUTOR_PERSONA,
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  await writeEntryFile({ root: repo.root, task: 'a', name: 'executor', bytes: 'claude' })
  // No .proofspec/config.json stands at the queue root, so no settings file names an executor.
  expect(existsSync(join(repo.root, '.proofspec', 'config.json'))).toBe(false)

  // The bare CLI's startSession is exactly this call with the queue root as its cwd.
  await withFakeTmux(() => tmuxStartSession(repo.root, 'a'))

  const worktree = join(repo.root, '.proofspec', 'worktrees', 'a')
  const settings = await readSettings(join(worktree, '.claude', 'settings.json'))
  const hook = providerErrorHook(settings, worktree)
  expect(hook, `the started TASK's worktree wires no provider-error entry on StopFailure (StopFailure runs ${JSON.stringify(hookCommands(settings, 'StopFailure'))})`).toBeDefined()
  expect(hook?.entryPath, 'the StopFailure hook does not run the provider-error entry the queue root holds').toBe(join(repo.root, INSTALLED_ENTRY_RELATIVE))
}, 20000)
