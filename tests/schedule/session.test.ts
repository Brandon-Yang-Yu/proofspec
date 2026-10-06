// Capability: schedule

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync, symlinkSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { listTmuxSessions, liveSessionCount, promptBodyFrom, reaperFor, resolveSessionWorktree, sessionStartFor, teardownTask, tmuxKillSessionCommand, tmuxListSessionsCommand, tmuxSessionCommands, tmuxStartSession } from '../../src/cli/session.ts'
import type { TmuxCommand } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'
import type { GitRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of the test body it belongs to — a thrown
// assertion earlier in that body would otherwise skip the delete and leak the override into
// every later test, exactly the kind of leaked ambient state this requirement exists to guard
// against. The same unconditional cleanup `judge-cli.test.ts` gives the variables and PATH its
// stand-ins read.
afterEach(() => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
})

/** The default socket name the STANDARD derives from a queue root's absolute path —
 *  `proofspec-` plus the first 8 hex digits of that path's SHA-256 digest. Each proof below
 *  computes it from that rule itself, so what is asserted is the derivation, never one
 *  implementation's spelling of it. */
function derivedSocketFor(queueRoot: string): string {
  return `proofspec-${createHash('sha256').update(queueRoot).digest('hex').slice(0, 8)}`
}

/** Writes the project's settings file — `.proofspec/config.json` under a queue root — the
 *  one committed file every per-project setting in the scenarios below is read from. */
async function writeSettings(queueRoot: string, settings: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(join(queueRoot, '.proofspec'), { recursive: true })
  await writeFile(join(queueRoot, '.proofspec', 'config.json'), `${JSON.stringify(settings, null, 2)}\n`)
}

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: A session start that fails throws an error carrying tmux's own stderr
// GIVEN a ready TASK whose tmux session start is forced to fail, so tmux itself writes its own words to stderr
// WHEN startSession runs
// THEN it throws an error carrying tmux's own stderr in its message, not a bare exit-code summary
it('throws an error carrying tmux\'s own stderr when starting the session fails', async () => {
  // The persona is read before any tmux call, so the scratch repo carries one — the throw
  // below must come from the start itself, not from a missing setup file.
  const repo = await makeGitRepo({ 'a.txt': 'a', '.pi/agents/executor.md': 'You are the executor.\n' })
  await enterTask(repo, 'a', { edit: 'a.txt' })

  // The reproducible forcing, the acceptance run's own: a regular file standing where
  // tmux's socket directory would be (tmux resolves -L <name> to <TMUX_TMPDIR>/tmux-<uid>/
  // <name>), under a throwaway TMUX_TMPDIR and a throwaway PROOFSPEC_TMUX_SOCKET. The
  // server cannot stand, so this is a real start failing with tmux's own words on stderr.
  // The kill fails the same ordinary way and stays ignored; this forcing cannot by itself
  // attribute the throw to the start — the healthy-start sibling below pins that half.
  const previousTmuxTmpdir = process.env.TMUX_TMPDIR
  const brokenSocketRoot = await mkdtemp(join(tmpdir(), 'proofspec-tmux-'))
  process.env.TMUX_TMPDIR = brokenSocketRoot
  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-start-fails'
  try {
    // @types/node marks getuid optional because Windows lacks it; tmux is POSIX-only, so
    // the fallback is for the type system alone, never reached where this test runs.
    const uid = process.getuid?.() ?? 0
    // A regular file where the socket directory would be — inside the try so a failed
    // write still restores TMUX_TMPDIR, which no afterEach cleans up.
    await writeFile(join(brokenSocketRoot, `tmux-${uid}`), '')
    // tmux's own diagnostic — wording only tmux writes, which a summary naming no cause
    // (a bare exit code) never carries.
    await expect(tmuxStartSession(repo.root, 'a')).rejects.toThrow(/is not a directory/)
  } finally {
    if (previousTmuxTmpdir === undefined) delete process.env.TMUX_TMPDIR
    else process.env.TMUX_TMPDIR = previousTmuxTmpdir
    await rm(brokenSocketRoot, { recursive: true, force: true })
  }
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: A start whose kill finds no stale session still stands one — the kill's ordinary failure stays ignored
// GIVEN a ready TASK whose name no session carries on the dedicated tmux server, so the kill before the start fails its ordinary way
// WHEN startSession runs
// THEN no error is thrown, and a detached session named for the TASK stands on that server
it('stands a session even when the kill before it finds no stale session, that failure staying ignored', async () => {
  // A fake pi on a throwaway PATH slot that parks — writes a marker, then sleeps — so the
  // started session stays standing while it is observed, and the marker says its harness
  // really ran. Never the real pi: an unattended start in a test has no business running it.
  const base = await mkdtemp(join(tmpdir(), 'proofspec-start-stands-'))
  const parkedFile = join(base, 'parked')
  await writeFile(join(base, 'pi'), `#!/bin/sh\ntouch ${JSON.stringify(parkedFile)}\nsleep 60\n`)
  await chmod(join(base, 'pi'), 0o755)
  // The persona is read before any tmux call, so the repo carries one.
  const repo = await makeGitRepo({ 'a.txt': 'a', '.pi/agents/executor.md': 'You are the executor.\n' })
  await enterTask(repo, 'a', { edit: 'a.txt' })

  const socket = 'proofspec-test-start-stands'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  // tmuxStartSession spawns its tmux clients with this process's own environment, and the
  // server the start brings up is started by one of those clients — so the fake pi rides
  // this process's PATH. The kill-server first keeps an older server with an older PATH
  // from answering, the same reasoning the metacharacters scenario records.
  const previousPath = process.env.PATH
  process.env.PATH = `${base}:${previousPath ?? ''}`
  await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {})
  try {
    // The real composition — worktree, persona, kill, start. Nothing carries the TASK's
    // name on the fresh server, so the kill fails its ordinary way right here. That this
    // resolves anyway is the scenario's point: an implementation that threw on the kill's
    // own failure dies on this very line, so the sibling above's throw can only come from
    // the start.
    await expect(tmuxStartSession(repo.root, 'a')).resolves.toBeUndefined()

    // Wait for the parked harness before reading the server, so "a session stands"
    // describes one whose process really runs, not one still spinning up.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !existsSync(parkedFile)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(existsSync(parkedFile), 'the started session\'s harness never ran').toBe(true)

    // Exactly one session stands on the throwaway server, named for the TASK — read the
    // way the docket reads it, over the same socket override the start honored (the root
    // the reader is handed is immaterial under the override).
    await expect(listTmuxSessions(repo.root)).resolves.toEqual(['a'])
    // Detached: no client attached, the only way an unattended session may stand.
    const listing = await execFileAsync('tmux', ['-L', socket, 'list-sessions'])
    expect(listing.stdout).not.toContain('(attached)')
  } finally {
    await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {})
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(base, { recursive: true, force: true })
  }
}, 15000)

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
  // The script itself, exactly — not a substring of it: the whole line is the STANDARD's
  // own words, and a script that also ran a bare `tmux kill-session` on the user's default
  // server would keep every substring check green while doing the machine-global harm
  // this requirement exists to prevent.
  expect(reaperFor('a', '/repo').args).toEqual(['-c', 'sleep "$PROOFSPEC_REAP_SECONDS" && exec tmux -L "$PROOFSPEC_REAP_SOCKET" kill-session -t "$PROOFSPEC_REAP_TASK"'])

  // And on disk, with the spellings manufactured rather than inherited from the
  // machine's own tmpdir: a whole-path symlinked alias of the root, and a mid-path
  // symlink on the route to it, each name the same queue. The start command is built
  // from the root spelling, and the reaper — handed each respelled root in turn — must
  // still resolve the socket that start named. A reaper hashing the handed spelling, or
  // resolving symlinks only when the handed path is itself one, kills on the alias's or
  // the route's other name for the same server and leaks the session; on a symlink-free
  // tmpdir this is the only form that still discriminates. The build holds the worktree
  // on disk, as a production start does.
  const holder = await mkdtemp(join(tmpdir(), 'proofspec-reaper-spelling-'))
  try {
    const root = join(holder, 'root')
    await mkdir(join(root, '.proofspec', 'worktrees', 'a'), { recursive: true })
    const alias = join(holder, 'alias')
    symlinkSync(root, alias)
    const midParent = join(holder, 'midparent')
    symlinkSync(holder, midParent)
    const midRoot = join(midParent, 'root')
    const [, start] = tmuxSessionCommands('a', { worktree: join(root, '.proofspec/worktrees/a'), queueRoot: root, systemPrompt: 'you are the executor' })
    expect(reaperFor('a', alias).reapEnv.PROOFSPEC_REAP_SOCKET).toBe(socketOf(start))
    expect(reaperFor('a', midRoot).reapEnv.PROOFSPEC_REAP_SOCKET).toBe(socketOf(start))
  } finally {
    await rm(holder, { recursive: true, force: true })
  }

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

  // The derived-default landing half — the same landing, with no override anywhere, so
  // the spawned kill runs in the default state the builder's values above only describe.
  // The session stands on the repo's own derived server; a teardown that spawned its own
  // bare, no-`-L` kill would leave that session standing and fail here. A sibling session
  // under a different name stands on the same server and must outlive the teardown — the
  // kill names the TASK's session, never the whole server — and a survivor on a second
  // named server must outlive it too: one server holds one repo's sessions, and the kill
  // reaches that one session on that server alone.
  delete process.env.PROOFSPEC_TMUX_SOCKET
  const repoDerived = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repoDerived, 'settled-derived', { edit: 'a.txt' })
  await repoDerived.git(['worktree', 'add', join(repoDerived.root, '.proofspec', 'worktrees', 'settled-derived'), 'work/settled-derived'])
  const [, derivedStart] = tmuxSessionCommands('settled-derived', { worktree: join(repoDerived.root, '.proofspec/worktrees/settled-derived'), queueRoot: repoDerived.root, systemPrompt: '' })
  const derived = socketOf(derivedStart)
  expect(derived).toMatch(/^proofspec-.+$/)
  const askDerived = (args: readonly string[]) => execFileAsync('tmux', ['-L', derived, ...args])
  const decoy = 'proofspec-test-reaper-decoy'
  const askDecoy = (args: readonly string[]) => execFileAsync('tmux', ['-L', decoy, ...args])
  const stands = (ask: (args: readonly string[]) => Promise<unknown>, name: string) => ask(['has-session', '-t', name]).then(() => true, () => false)
  await askDerived(['kill-server']).catch(() => {})
  await askDecoy(['kill-server']).catch(() => {})
  try {
    await askDerived(['new-session', '-d', '-s', 'settled-derived', 'sleep', '60'])
    await askDerived(['new-session', '-d', '-s', 'sibling-task', 'sleep', '60'])
    await askDecoy(['new-session', '-d', '-s', 'survivor', 'sleep', '60'])
    await teardownTask(repoDerived.root, 'settled-derived')
    await expect(stands(askDerived, 'settled-derived')).resolves.toBe(true)
    const gone = Date.now() + 5000
    while (Date.now() < gone && (await stands(askDerived, 'settled-derived'))) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await expect(stands(askDerived, 'settled-derived')).resolves.toBe(false)
    await expect(stands(askDerived, 'sibling-task')).resolves.toBe(true)
    await expect(stands(askDecoy, 'survivor')).resolves.toBe(true)
  } finally {
    await askDerived(['kill-server']).catch(() => {})
    await askDecoy(['kill-server']).catch(() => {})
  }
}, 20000)

// The start command's own command words are `sh <runner script path>` — pi's whole
// invocation, with every flag and text it needs, lives in that script's content, so every
// promise below about pi's own argv is read from the file those words name.
async function runnerScriptFrom(start: TmuxCommand): Promise<string> {
  const scriptPath = start.args[start.args.indexOf('sh') + 1]
  expect(scriptPath).toBeDefined()
  return readFile(scriptPath!, 'utf8')
}

/** A base branch name only a settings file in these proofs ever names — distinctive enough
 *  that no temp path, socket name, TASK name, or prompt text can contain it by accident. */
const FILE_ONLY_BRANCH = 'settings-file-only-base-q7z'

/** Every text the built commands hand down to the session: each command's own words, and the
 *  content of every file those words name — the runner script, the system prompt file, and
 *  the generated MCP config the claude build writes, whether named bare or as a `NAME=path`
 *  environment entry — plus every file those contents name in turn. A value handed down
 *  anywhere in that set reaches the session; a value in none of it does not. */
async function everythingHandedDown(commands: readonly TmuxCommand[]): Promise<readonly string[]> {
  const texts: string[] = []
  const readFilesNamedIn = async (text: string): Promise<string[]> => {
    const paths = text.match(/\/[^\s"'`$()=]+/g) ?? []
    const contents: string[] = []
    for (const path of new Set(paths)) {
      if (existsSync(path) && statSync(path).isFile()) contents.push(await readFile(path, 'utf8'))
    }
    return contents
  }
  for (const command of commands) {
    texts.push(command.command, ...command.args)
    for (const arg of command.args) {
      for (const content of await readFilesNamedIn(arg)) {
        texts.push(content, ...(await readFilesNamedIn(content)))
      }
    }
  }
  return texts
}

/** The socket a built tmux command reaches tmux through — the value at its `-L` flag's
 *  head. Holding the `-L`-at-the-head fact inside the read keeps every proof that names a
 *  socket honest with one line: a command on the user's default server carries no `-L` at
 *  all. */
function socketOf(command: TmuxCommand): string {
  expect(command.args[0]).toBe('-L')
  return command.args.slice(0, 2)[1]!
}

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi
// GIVEN a tmux session already named for the TASK
// WHEN the tmux commands to start its session are built
// THEN the first kills that stale session, and the second starts a fresh one running pi
//      under the same name, in the TASK's own worktree, detached
it('kills a stale tmux session by the TASK\'s name before starting a fresh one running pi', async () => {
  const [kill, start] = tmuxSessionCommands('a', { worktree: '/repo/.proofspec/worktrees/a', queueRoot: '/repo', systemPrompt: 'you are the executor' })

  // The kill names the root's own derived socket — the STANDARD's rule, computed here
  // from the path, never a literal — so the kill and the start below land on one server.
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: The tmux start command carries PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK, and carries no PROOFSPEC_BASE_BRANCH
// GIVEN a ready TASK
// WHEN the tmux start command is built
// THEN it hands the session the queue's checkout and the TASK's name as environment
//      variables, and carries no `PROOFSPEC_BASE_BRANCH` — the session reads the base branch
//      from the settings file at the queue root it was handed
it('carries PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK as environment variables on the start command, and carries no PROOFSPEC_BASE_BRANCH', async () => {
  // A queue root whose settings file names a base branch — the strongest form of the
  // absence: the branch is named somewhere the session can read it, and the start command
  // still hands down none of it, because the session reads the name from the settings
  // file at the queue root it is handed.
  // The branch name is one no path, socket, or task name here can hold, so finding it anywhere
  // in what is handed down can only mean the name itself was handed down.
  const queue = await makeRepo({})
  await writeSettings(queue.root, { baseBranch: FILE_ONLY_BRANCH })
  const commands = tmuxSessionCommands('a', { worktree: `${queue.root}/.proofspec/worktrees/a`, queueRoot: queue.root, systemPrompt: '' })
  const [, start] = commands

  // Pairwise scans, not a positional slice — the STANDARD and the CLAIM name the
  // variables without ordering them, and a flag appended after another -e (KICKOFF,
  // say) still satisfies them. Each scan proves some -e immediately precedes the value
  // it names.
  const carries = (value: string): boolean => {
    for (let i = 0; i + 1 < start.args.length; i++) {
      if (start.args[i] === '-e' && start.args[i + 1] === value) return true
    }
    return false
  }
  expect(carries(`PROOFSPEC_QUEUE_ROOT=${queue.root}`)).toBe(true)
  expect(carries('PROOFSPEC_TASK=a')).toBe(true)
  // The base branch rides no environment entry at all, nor anything the commands write for
  // the session to run — the settings file at the queue root the session was handed is the
  // one place the name is read from.
  expect(start.args.filter(arg => arg.startsWith('PROOFSPEC_BASE_BRANCH'))).toEqual([])
  expect((await everythingHandedDown(commands)).filter(text => text.includes('PROOFSPEC_BASE_BRANCH'))).toEqual([])
  // Nor under another name: the branch the file names appears nowhere in what is handed down.
  expect((await everythingHandedDown(commands)).filter(text => text.includes(FILE_ONLY_BRANCH))).toEqual([])
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: With no executor record, and the settings file naming no executor or naming pi, the started harness is pi
// GIVEN a TASK whose queue entry holds no executor record, and a settings file at the
//       queue root holding no executor key, and then one naming pi
// WHEN the tmux commands to start the TASK's session are built
// THEN each time the start command's agent is the pi invocation — and naming pi builds the
//      same invocation the absent key builds
it('starts the pi invocation for a TASK with no executor record when the settings file names no executor, and when it names pi', async () => {
  // A real queue entry standing for the TASK, holding everything but an executor record —
  // so the settings file decides because the entry is silent, not because no entry exists.
  const queue = await makeRepo({ '.proofspec/dispatch/a/state': 'building' })
  const build = () => tmuxSessionCommands('a', { worktree: `${queue.root}/.proofspec/worktrees/a`, queueRoot: queue.root, systemPrompt: '' })

  // Each GIVEN case built and read on its own — the default must survive the harness
  // choice being named, not silently drift the moment the key starts being read. Naming pi
  // must reach the same invocation, not a pi-shaped shortcut: the pi-named build's runner
  // script is the absent-key build's own script, byte for byte — pins included, since the
  // scenarios above prove what the absent-key build's script carries.
  await writeSettings(queue.root, {})
  const absentKeyScript = await runnerScriptFrom(build()[1])
  await expect(absentKeyScript).toMatch(/^exec pi\b/)
  expect(build()[1].args.join('\n')).not.toContain('PROOFSPEC_MCP_CONFIG')

  await writeSettings(queue.root, { executor: 'pi' })
  const namedPiScript = await runnerScriptFrom(build()[1])
  await expect(namedPiScript).toMatch(/^exec pi\b/)
  expect(build()[1].args.join('\n')).not.toContain('PROOFSPEC_MCP_CONFIG')
  expect(namedPiScript, 'naming pi must carry the absent-key build\'s own pinned runner script').toBe(absentKeyScript)
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: With no executor record, the settings file's executor naming claude starts the claude invocation: the executor's own system prompt appended, permissions skipped, and a generated MCP config naming the queue root's own MCP server
// GIVEN a TASK whose queue entry holds no executor record, a settings file at the queue
//       root whose executor names claude, the TASK's worktree, and the queue root
// WHEN the tmux start command is built
// THEN the agent it starts is claude, run with `--append-system-prompt` carrying the
//      executor's own system prompt, with `--dangerously-skip-permissions`, and with a
//      generated MCP config naming the queue root's own MCP server
it('starts the claude invocation for a TASK with no executor record when the settings file names claude', async () => {
  // A real queue entry standing for the TASK, holding everything but an executor record —
  // the settings file names the harness because the entry is silent.
  const queue = await makeRepo({ '.proofspec/dispatch/a/state': 'building' })
  const queueRoot = queue.root
  await writeSettings(queueRoot, { executor: 'claude' })

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
  // location: the one server it names is the queue root's own MCP server. This queue
  // root is a project that installed ProofSpec — the root holds a queue entry and
  // nothing else, so the kind is stated
  // by the package.json-name rule: no `package.json` there, so not ProofSpec's own
  // checkout — and that kind's entry is the installed package's built server,
  // `node_modules/proofspec/dist/mcp/serve.js` under the queue root. A config naming
  // a different entry, or a second server beside the real one, is a different answer
  // than the one claimed.
  const entries = Object.entries(config.mcpServers ?? {})
  expect(entries.length, 'the config must name exactly one MCP server').toBe(1)
  for (const [, server] of entries) {
    const words = [server.command, ...(Array.isArray(server.args) ? server.args : [])]
      .filter((word): word is string => typeof word === 'string')
    expect(
      words,
      `the server the config names is not the queue root's own MCP server entry`,
    ).toContain(join(queueRoot, 'node_modules', 'proofspec', 'dist', 'mcp', 'serve.js'))
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

/** Which agent a real start ran, the exact argv it was handed, and the directory it ran in. */
type AgentRun = { readonly agent: 'pi' | 'claude'; readonly argv: readonly string[]; readonly cwd: string }

/**
 * Runs the real `startSession` for a TASK against a throwaway tmux server, with a fake `pi`
 * and a fake `claude` on a throwaway PATH slot — each records its own name, the argv it
 * was handed, and the physical directory it ran in, then exits. Never the real harnesses: an unattended start in a test has no
 * business running either. What is observed is the agent the start really ran, not a
 * command merely built, because the choice this proves is made by the start itself.
 */
async function startAndObserve(repo: GitRepo, task: string): Promise<AgentRun> {
  const base = await mkdtemp(join(tmpdir(), 'proofspec-harness-choice-'))
  const ranFile = join(base, 'ran.json')
  for (const agent of ['pi', 'claude'] as const) {
    await writeFile(join(base, agent), `#!/usr/bin/env node
import { renameSync, writeFileSync } from 'node:fs'
// Written aside, then renamed into place: the poll below reads the file the moment it
// exists, and a rename lands it whole, never empty or half-written.
writeFileSync(${JSON.stringify(`${ranFile}.tmp`)}, JSON.stringify({ agent: ${JSON.stringify(agent)}, argv: process.argv.slice(2), cwd: process.cwd() }))
renameSync(${JSON.stringify(`${ranFile}.tmp`)}, ${JSON.stringify(ranFile)})
`)
    await chmod(join(base, agent), 0o755)
  }
  const socket = 'proofspec-test-harness-choice'
  process.env.PROOFSPEC_TMUX_SOCKET = socket
  // The server a start brings up inherits this process's PATH, so the fakes ride it; the
  // kill-server first keeps an older server with an older PATH from answering.
  const previousPath = process.env.PATH
  process.env.PATH = `${base}:${previousPath ?? ''}`
  await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {})
  try {
    await tmuxStartSession(repo.root, task)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !existsSync(ranFile)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(existsSync(ranFile), 'the started session never ran an agent').toBe(true)
    return JSON.parse(await readFile(ranFile, 'utf8')) as AgentRun
  } finally {
    await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {})
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(base, { recursive: true, force: true })
  }
}

/** A ready TASK in a scratch repo carrying the executor persona, its queue entry holding
 *  the given `executor` file — or none at all. */
async function readyTask(executorRecord: string | undefined): Promise<GitRepo> {
  const repo = await makeGitRepo({ 'a.txt': 'a', '.pi/agents/executor.md': 'You are the executor.\n' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  if (executorRecord !== undefined) await repo.write('.proofspec/dispatch/a/executor', executorRecord)
  return repo
}

/** Holds a real run to the claude invocation: claude and never pi, the executor's own
 *  persona appended, permissions skipped, and a generated MCP config naming the queue
 *  root's own server — the installed package's built entry, since a scratch repo carries
 *  no `package.json` naming ProofSpec's own checkout. */
async function expectClaudeInvocation(run: AgentRun, queueRoot: string): Promise<void> {
  expect(run.agent).toBe('claude')
  const promptIndex = run.argv.indexOf('--append-system-prompt')
  expect(promptIndex, 'claude was handed no --append-system-prompt').toBeGreaterThan(-1)
  expect(run.argv[promptIndex + 1]).toBe('You are the executor.')
  expect(run.argv).toContain('--dangerously-skip-permissions')
  const configIndex = run.argv.indexOf('--mcp-config')
  expect(configIndex, 'claude was handed no --mcp-config').toBeGreaterThan(-1)
  const config = JSON.parse(await readFile(run.argv[configIndex + 1]!, 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> }
  const servers = Object.values(config.mcpServers ?? {})
  expect(servers.length, 'the config must name exactly one MCP server').toBe(1)
  const words = [servers[0]!.command, ...(Array.isArray(servers[0]!.args) ? servers[0]!.args : [])]
  expect(words).toContain(join(queueRoot, 'node_modules', 'proofspec', 'dist', 'mcp', 'serve.js'))
}

/** Holds a real run to the pi invocation: pi and never claude, its leading argv the flags in
 *  the order the invocation hands them — both pins resolved under the queue root the start
 *  ran from. */
function expectPiInvocation(run: AgentRun, queueRoot: string): void {
  expect(run.agent).toBe('pi')
  expect(run.argv.slice(0, 6)).toEqual([
    '--approve', '--no-extensions',
    '--extension', join(queueRoot, '.pi', 'extensions', 'progress.ts'),
    '--extension', join(queueRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'subagent', 'index.ts'),
  ])
}

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: A TASK whose queue entry's executor record holds claude starts the claude invocation, whatever the settings file names: the executor's own system prompt appended, permissions skipped, and a generated MCP config naming the queue root's own MCP server
// GIVEN a ready TASK whose queue entry holds an executor record naming claude, and a
//       settings file at the queue root whose executor names pi, and then one holding no
//       executor key
// WHEN the TASK's session is started through the bare CLI's startSession
// THEN each time the agent started in the TASK's worktree is claude, never pi, run with
//      `--append-system-prompt` carrying the executor's own system prompt, with
//      `--dangerously-skip-permissions`, and with a generated MCP config naming the queue
//      root's own MCP server
it('starts the claude invocation for a TASK whose executor record holds claude, whatever the settings file names', async () => {
  const repo = await readyTask('claude')

  // Started in the TASK's worktree, not the queue root: both sides compared as real paths,
  // since the scratch repo sits under a symlinked temp dir on macOS.
  const worktree = (): string => realpathSync(join(repo.root, '.proofspec', 'worktrees', 'a'))

  // Each GIVEN case started on its own: the settings file's named pi and its absent key
  // both lose to the record — a TASK moved to claude stays on it through every later start.
  await writeSettings(repo.root, { executor: 'pi' })
  const namedPi = await startAndObserve(repo, 'a')
  await expectClaudeInvocation(namedPi, repo.root)
  expect(realpathSync(namedPi.cwd), 'claude was not started in the TASK\'s worktree').toBe(worktree())

  await writeSettings(repo.root, {})
  const absentKey = await startAndObserve(repo, 'a')
  await expectClaudeInvocation(absentKey, repo.root)
  expect(realpathSync(absentKey.cwd), 'claude was not started in the TASK\'s worktree').toBe(worktree())
}, 30000)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: A TASK whose queue entry's executor record holds pi starts the pi invocation, even when the settings file names claude: --approve, --no-extensions, and both pinned extensions
// GIVEN a ready TASK whose queue entry holds an executor record naming pi, and a settings
//       file at the queue root whose executor names claude
// WHEN the TASK's session is started through the bare CLI's startSession
// THEN the agent started is pi, never claude, run with `--approve`, `--no-extensions`,
//      and both pinned extensions
it('starts the pi invocation for a TASK whose executor record holds pi, even when the settings file names claude', async () => {
  const repo = await readyTask('pi')
  await writeSettings(repo.root, { executor: 'claude' })

  expectPiInvocation(await startAndObserve(repo, 'a'), repo.root)
}, 15000)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: An executor record naming neither pi nor claude counts as no record, and the settings file's executor decides either way
// GIVEN a ready TASK whose queue entry holds an executor file naming neither pi nor claude
//       (for example codex), and a settings file at the queue root whose executor names
//       claude, and then names pi
// WHEN the TASK's session is started through the bare CLI's startSession, once under each
//       value the settings file names
// THEN each time the agent started is the one the settings file names, run as the invocation
//       a TASK with no record gets under that same value: with claude, claude with the
//       executor's own system prompt appended, permissions skipped, and a generated MCP config
//       naming the queue root's own MCP server; with pi, pi with `--approve`,
//       `--no-extensions`, and both pinned extensions
it('lets the settings file decide either way when the executor record names neither pi nor claude', async () => {
  const repo = await readyTask('codex')

  await writeSettings(repo.root, { executor: 'claude' })
  await expectClaudeInvocation(await startAndObserve(repo, 'a'), repo.root)

  // The settings file decides, not the record's mere presence: with the same unknown record
  // and the file naming pi, the start is the full pi invocation. Without this, a build that
  // reads any record other than pi as claude would pass the case above.
  await writeSettings(repo.root, { executor: 'pi' })
  expectPiInvocation(await startAndObserve(repo, 'a'), repo.root)
}, 30000)

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: The claude invocation carries the same environment variables and the same positional kickoff message the pi one carries
// GIVEN the settings file at the queue root naming claude as its executor
// WHEN the tmux start command is built
// THEN it carries `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK` as environment variables
//      naming the main checkout and the TASK, carries no `PROOFSPEC_BASE_BRANCH`, and hands
//      claude one positional kickoff message telling the session to begin working its TASK —
//      the same message the pi invocation carries
it('carries the same environment variables and the same positional kickoff message on the claude invocation', async () => {
  // A real queue root whose settings file names claude — the harness this build runs rides
  // the file, never an environment variable.
  const queue = await makeRepo({ '.proofspec/dispatch/dispatch-me/state': 'building' })
  // It names a base branch too, one no path or name here can hold, so the claude build is held
  // to handing the branch down under no name at all.
  await writeSettings(queue.root, { executor: 'claude', baseBranch: FILE_ONLY_BRANCH })
  const build = () => tmuxSessionCommands('dispatch-me', { worktree: `${queue.root}/.proofspec/worktrees/dispatch-me`, queueRoot: queue.root, systemPrompt: 'you are the executor' })

  const commands = build()
  const [, start] = commands

  // The same pairwise scans the pi scenario carries — each -e immediately precedes the value
  // it names, on the same tmux new-session command either harness runs, with no ordering
  // assumed between the entries.
  const carries = (value: string): boolean => {
    for (let i = 0; i + 1 < start.args.length; i++) {
      if (start.args[i] === '-e' && start.args[i + 1] === value) return true
    }
    return false
  }
  expect(carries(`PROOFSPEC_QUEUE_ROOT=${queue.root}`)).toBe(true)
  expect(carries('PROOFSPEC_TASK=dispatch-me')).toBe(true)
  // The base branch rides no environment entry here either, nor the claude runner script or
  // the MCP config it is handed — the session reads it from the settings file at the queue
  // root it was handed, whichever harness it runs.
  expect(start.args.filter(arg => arg.startsWith('PROOFSPEC_BASE_BRANCH'))).toEqual([])
  expect((await everythingHandedDown(commands)).filter(text => text.includes('PROOFSPEC_BASE_BRANCH'))).toEqual([])
  expect((await everythingHandedDown(commands)).filter(text => text.includes(FILE_ONLY_BRANCH))).toEqual([])
  // The kickoff rides the same environment entry the pi runner reads, and the claude runner
  // hands it to claude as the one positional prompt argument, leading every flag. An
  // unattended session handed no first message never begins working its TASK. The same
  // message, read literally: the claude build's kickoff is the pi build's kickoff, byte
  // for byte.
  await writeSettings(queue.root, { executor: 'pi' })
  const piKickoff = build()[1].args.find(arg => arg.startsWith('PROOFSPEC_KICKOFF='))
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: The default socket is derived from the queue root, so two repos never share a server
// GIVEN the socket override unset, two different queue roots, and one real root spelled two ways — a whole-path symlink beside it, and a mid-path symlink on the route to it
// WHEN the tmux commands to start a TASK's session are built for each root
// THEN every command reaches tmux through -L on a name of the per-repo
//      proofspec-<short hash> shape — the same name for the same root on every build and
//      however that root is spelled, and a different name for the other root
it('derives the default socket from the queue root, so two repos never share a server', async () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET

  // The algorithm itself is pinned by the sibling scenario above; what only this proof
  // carries is the root-dependence — read off the built commands, never re-derived, so
  // these facts cannot drift from what the builders actually do.
  const socketForRoot = (queueRoot: string, task = 'a'): string => {
    const sockets = tmuxSessionCommands(task, { worktree: `${queueRoot}/.proofspec/worktrees/${task}`, queueRoot, systemPrompt: '' }).map(socketOf)
    for (const socket of sockets) expect(socket).toMatch(/^proofspec-.+$/)
    // One root, one server, for every command of the build — never the kill's alone, so
    // root-dependence below holds for the start command through the same tie.
    expect(new Set(sockets).size).toBe(1)
    return sockets[0]!
  }

  const one = socketForRoot('/one')
  const two = socketForRoot('/two')
  // Same root, same name on every build — whatever TASK the build is for: the server is
  // the repo's, not the TASK's, so a different task must not move the name.
  expect(socketForRoot('/one')).toBe(one)
  expect(socketForRoot('/one', 'b')).toBe(one)
  // Two roots, two names — the whole point of the derivation. The roots differ in every
  // component, and then again in the last one only: the hashed fact is the root's whole
  // absolute path, never its basename — two clones sharing a directory name in different
  // parents are two repos, and must never share a server.
  expect(two).not.toBe(one)
  expect(socketForRoot('/x/repo')).not.toBe(socketForRoot('/y/repo'))

  // And one path is one repo however it is spelled: a symlinked alias of a real root
  // names the same queue, and the same queue derives the same name. A derivation hashing
  // the spelling as handed would move the name with the alias and fail here, on any
  // machine, with no reliance on the machine's own symlinked tmpdir. The builds carry a
  // non-empty prompt and a worktree that stands on disk — the two facts a production
  // build always holds — so no switch keyed on either can turn inside them; every
  // command of each build is held to it and to the shape, never the kill's alone.
  const holder = await mkdtemp(join(tmpdir(), 'proofspec-socket-spelling-'))
  try {
    const root = join(holder, 'realparent', 'root')
    await mkdir(join(root, '.proofspec', 'worktrees', 'a'), { recursive: true })
    const alias = join(holder, 'alias')
    symlinkSync(root, alias)
    const byRoot = tmuxSessionCommands('a', { worktree: join(root, '.proofspec/worktrees/a'), queueRoot: root, systemPrompt: 'you are the executor' }).map(socketOf)
    const byAlias = tmuxSessionCommands('a', { worktree: join(alias, '.proofspec/worktrees/a'), queueRoot: alias, systemPrompt: 'you are the executor' }).map(socketOf)
    // A mid-path spelling too: the symlink sits on the route to the root, not over the
    // whole of it — the `/var` vs `/private/var` shape the canonicalization exists for.
    // An implementation resolving symlinks only when the handed path is itself one passes
    // the whole-path tie above and dies here.
    const midPath = join(holder, 'midparent', 'root')
    symlinkSync(join(holder, 'realparent'), join(holder, 'midparent'))
    const byMidPath = tmuxSessionCommands('a', { worktree: join(midPath, '.proofspec/worktrees/a'), queueRoot: midPath, systemPrompt: 'you are the executor' }).map(socketOf)
    for (const socket of [...byRoot, ...byAlias, ...byMidPath]) expect(socket).toMatch(/^proofspec-.+$/)
    // The named rule itself, held absolutely where the root stands — the port test's own
    // form: the rule computed locally from the canonical root, the built commands held to
    // it, so no digest variant that switches on the root's existence can pass.
    expect(byRoot[0]).toBe(`proofspec-${createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 8)}`)
    // And a queue-root-only surface tied to a production-facts build: the list command,
    // built for this root alone with no worktree fact of its own, names the same server
    // the worktree-on-disk build named — a canonicalization keyed on the worktree's
    // existence splits them and dies here.
    expect(socketOf(tmuxListSessionsCommand(root))).toBe(byRoot[0])
    // The within-build tie too, for roots that stand on disk — the same one-server fact
    // `socketForRoot` holds for the synthetic roots, so this proof carries it for both.
    expect(new Set(byRoot).size).toBe(1)
    expect(byAlias).toEqual(byRoot)
    expect(byMidPath).toEqual(byRoot)
    // And two real roots sharing a directory name under different parents are two repos:
    // the whole-path fact, held on disk the same as off it — the exact two-clones harm
    // this scenario exists to prevent.
    const rootA = join(holder, 'a', 'repo')
    const rootB = join(holder, 'b', 'repo')
    await mkdir(rootA, { recursive: true })
    await mkdir(rootB, { recursive: true })
    expect(socketForRoot(rootA)).not.toBe(socketForRoot(rootB))
  } finally {
    await rm(holder, { recursive: true, force: true })
  }
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
// Scenario: PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target
// GIVEN PROOFSPEC_TMUX_SOCKET names a different socket
// WHEN the tmux commands to start a TASK's session are built
// THEN every command targets that socket instead of the root's derived one
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
it('asks the dedicated server for the live count by its own -L socket, never the default one', async () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  // The count command is built from a queue root, targeting that root's own derived
  // default — the STANDARD's rule, computed here from the path — and carrying -L at all
  // is half the claim on its own: the user's default server is reached by carrying no -L.
  const queueRoot = '/repo'
  expect(tmuxListSessionsCommand(queueRoot)).toEqual({ command: 'tmux', args: ['-L', derivedSocketFor(queueRoot), 'list-sessions'] })

  // The runtime half: a scheduling pass asks the counter itself, handed the queue root the
  // pass runs for. One session stands on a real root's own derived server, the counter
  // asks for that root, and the count reaches it — with no override anywhere to hide a
  // wrong root behind. The shape is held before any tmux runs, so the suite can never
  // stand a session on the machine's real bare-name server by way of the retired default.
  const root = await mkdtemp(join(tmpdir(), 'proofspec-count-socket-'))
  const derived = socketOf(tmuxSessionCommands('a', { worktree: join(root, '.proofspec/worktrees/a'), queueRoot: root, systemPrompt: '' })[1]!)
  expect(derived).toMatch(/^proofspec-.+$/)
  const askDerived = (args: readonly string[]) => execFileAsync('tmux', ['-L', derived, ...args])
  // A decoy pair of sessions stands on a second throwaway server for the whole ask: the
  // count is asked of the root's own derived server only. Two decoys, not one, so no
  // aggregation across servers can answer 1 — a summing wrapper answers 3, a
  // max-across-servers wrapper answers 2, and a wrapper pointed at the decoy alone
  // answers 2; only asking the derived server and it alone answers 1.
  const decoy = 'proofspec-test-count-decoy'
  const askDecoy = (args: readonly string[]) => execFileAsync('tmux', ['-L', decoy, ...args])
  try {
    await askDerived(['kill-server']).catch(() => {})
    await askDecoy(['kill-server']).catch(() => {})
    await askDerived(['new-session', '-d', '-s', 'only', 'sleep', '60'])
    await askDecoy(['new-session', '-d', '-s', 'decoy-one', 'sleep', '60'])
    await askDecoy(['new-session', '-d', '-s', 'decoy-two', 'sleep', '60'])
    await expect(liveSessionCount(root)).resolves.toBe(1)
    // And the answer moves with the derived server's own list — a wrapper that asks some
    // fixed other server answers its own constant twice, not one then two. Only the ask
    // that reads this root's derived server, fresh, answers both.
    await askDerived(['new-session', '-d', '-s', 'second', 'sleep', '60'])
    await expect(liveSessionCount(root)).resolves.toBe(2)
    // The spelling half: the root handed through a symlinked alias of itself, and again
    // through a mid-path symlink on the route to it — the count still reads the same
    // derived server's list under both spellings, so a reader that canonicalizes only
    // some spellings splits from the scheduler's server and fails here.
    const alias = join(dirname(root), `alias-of-${basename(root)}`)
    const midParent = join(dirname(root), `midparent-of-${basename(root)}`)
    symlinkSync(root, alias)
    symlinkSync(dirname(root), midParent)
    const midRoot = join(midParent, basename(root))
    try {
      await expect(liveSessionCount(alias)).resolves.toBe(2)
      await expect(liveSessionCount(midRoot)).resolves.toBe(2)
    } finally {
      await rm(alias, { force: true })
      await rm(midParent, { force: true })
    }
  } finally {
    await askDerived(['kill-server']).catch(() => {})
    await askDecoy(['kill-server']).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }

  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'
  expect(tmuxListSessionsCommand(queueRoot)).toEqual({ command: 'tmux', args: ['-L', 'proofspec-test-run-42', 'list-sessions'] })
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
    // A second window inside the first session — pinned alive by its own `sleep`, like
    // the sessions themselves, so the discrimination holds on any machine: the unit
    // counted is the session, never the window — a window-counting implementation
    // answers three here and fails.
    await tmux(['new-window', '-t', 'one', 'sleep', '60'])

    await expect(liveSessionCount('/repo')).resolves.toBe(2)

    await tmux(['kill-session', '-t', 'one'])
    await expect(liveSessionCount('/repo')).resolves.toBe(1)

    await tmux(['kill-server'])
    await expect(liveSessionCount('/repo')).resolves.toBe(0)
  } finally {
    await tmux(['kill-server']).catch(() => {})
  }
})

// Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the TASK's harness there, headed
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
