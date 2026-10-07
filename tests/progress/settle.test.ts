// Capability: progress

import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { SchedulingPassPlan } from '../../src/cli/settle.ts'
import { executeSettleTask, runSettleTask } from '../../src/progress/extension.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'
import type { GitRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)

afterEach(cleanupRepos)
afterEach(async () => {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
  await execFileAsync('tmux', ['-L', SOCKET, 'kill-server']).catch(() => {})
})

// Every settle in this suite targets this throwaway socket — the reaper's kill included — so
// nothing here can ever reach a real session on the production socket, the exact override
// PROOFSPEC_TMUX_SOCKET exists to provide. Set once for the whole file and never deleted in
// the per-test cleanup: the reaper reads it at spawn time, so a test that ran after a delete
// would schedule its kill against the production socket — the one failure this override
// exists to make impossible.
const SOCKET = 'proofspec-settle-test'
process.env.PROOFSPEC_TMUX_SOCKET = SOCKET

/** The TASK's own state word, read back from its queue entry. */
async function stateOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'state'), 'utf8')
}

/** Whether a tmux session with the TASK's name still stands on the dedicated server. */
function hasSession(task: string): Promise<boolean> {
  return execFileAsync('tmux', ['-L', SOCKET, 'has-session', '-t', task]).then(
    () => true,
    () => false,
  )
}

/** Waits until no session with the TASK's name stands, answering false if one still does
 *  after the deadline — the bound is a few times the reaper's two-second delay, so a kill
 *  landing anywhere near it is a failure worth seeing rather than a timing corner to
 *  widen. */
async function sessionGoneWithin(task: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!(await hasSession(task))) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !(await hasSession(task))
}

/** Whether a process with the given pid still exists — a signal-0 probe, catching the
 *  nothing-to-signal error as the answer. */
function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Reads a file once it holds text, polling for a short while: the stand-in pass writes
 *  its record from its own process, so the read has to wait out that write. Answers
 *  undefined at the deadline — an assertable absence rather than a thrown race. */
async function readWhenWritten(path: string): Promise<string | undefined> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const text = await readFile(path, 'utf8').then(content => content.trim(), () => undefined)
    if (text !== undefined && text !== '') return text
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return undefined
}

/** Whether a worktree still stands at the TASK's conventional path. */
async function worktreeStands(root: string, task: string): Promise<boolean> {
  return stat(join(root, '.proofspec', 'worktrees', task)).then(
    () => true,
    () => false,
  )
}

/** The no-op fire every proof that reaches an ok settle hands the settle: a successful
 *  settle fires one scheduling pass, and this injected no-op is how a proof reaches that
 *  ok without ever starting a real pass. */
const fireNothing = () => {}

/** One TASK positioned to be settled — or refused: a landed or unlanded branch, a state word of
 *  the caller's choosing, a worktree at the conventional path, and a live session carrying
 *  the TASK's name on the throwaway socket. The task name is unique per test because the
 *  reaper kills by that name: a shared name would let one test's reaper kill the next
 *  test's fresh session inside the reaper's delay. */
async function makeSettlableTask(options: {
  readonly task: string
  readonly landed: boolean
  readonly word: string
  /** The repo's base files, committed on `main` before the TASK's branch is cut. The default
   *  is the suite's original one-file repo; the real-fire proofs pass a repo shaped like a
   *  consumer's, or one whose queue gives the fired pass work to speak about. */
  readonly files?: Readonly<Record<string, string>>
}): Promise<GitRepo> {
  const repo = await makeGitRepo(options.files ?? { 'a.txt': 'a' })
  await enterTask(repo, options.task, { edit: 'a.txt' })
  if (options.landed) await repo.git(['merge', `work/${options.task}`])
  await repo.write(`.proofspec/dispatch/${options.task}/state`, options.word)
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', options.task), `work/${options.task}`])
  await execFileAsync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', options.task, 'sleep', '60'])
  return repo
}

/** The ISO 8601 spelling of a moment — the house form (`writeHeartbeat` writes one), and so
 *  the form a settle-pass log header's "naming the time" is read in. */
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/

/** How long the real-fire proofs wait for a fired pass to finish speaking: the settle
 *  answers the moment the pass has started, so everything the pass then does — its session
 *  starts, its log writes — lands after the settle has returned, and the read has to wait
 *  out a node startup and a scheduling pass. */
const PASS_DEADLINE_MS = 20_000

/** The window a header line's "naming the time" is held to: minutes, wide enough for the
 *  time the pass takes, narrow enough that a stale or future timestamp fails. */
const TEN_MINUTES_MS = 10 * 60 * 1000

/** A file's text once it holds every marker, polled past the settle's own answer. Answers
 *  undefined at the deadline — an assertable absence rather than a thrown race. */
async function textWhenAllMarked(path: string, markers: readonly string[]): Promise<string | undefined> {
  const deadline = Date.now() + PASS_DEADLINE_MS
  while (Date.now() < deadline) {
    const text = await readFile(path, 'utf8').catch(() => undefined)
    if (text !== undefined && markers.every(marker => text.includes(marker))) return text
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return undefined
}

/** The header line of one pass's section in the settle-pass log: the one line that names
 *  the TASK and carries a time. Which words surround the two facts is the writer's own; the
 *  proof reads the facts, not the format. */
function headerNaming(text: string, task: string): string | undefined {
  return text.split('\n').find(line => line.includes(task) && ISO_TIME.test(line))
}

/** How many lines in a stretch of the log carry one pass's header shape — the TASK and
 *  a time on one line. The STANDARD's "one header line" is a count, so the proofs count
 *  it, not just find it. */
function countHeaders(text: string, task: string): number {
  return text.split('\n').filter(line => line.includes(task) && ISO_TIME.test(line)).length
}

/** Whether a header line's timestamp falls inside the proof's own run. */
function namesRecentTime(header: string): boolean {
  const written = header.match(ISO_TIME)
  if (written === null) return false
  const at = Date.parse(written[0])
  return Number.isFinite(at) && Math.abs(Date.now() - at) < TEN_MINUTES_MS
}

/** A stand-in `pi`, the harness a started session runs: it records the TASK it was started
 *  for and the queue root it was handed — the two facts the real-fire proof observes — then
 *  waits, so no real agent session ever starts. The acceptance drive's own stand-in, as a
 *  fixture. */
async function makeStubPi(): Promise<{ readonly binDir: string; readonly startedAt: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'proofspec-stub-pi-'))
  const binDir = join(directory, 'bin')
  await mkdir(binDir)
  const startedAt = join(directory, 'started.txt')
  const script = join(binDir, 'pi')
  await writeFile(script, [
    '#!/bin/sh',
    `printf 'started %s in %s\\n' "$PROOFSPEC_TASK" "$PROOFSPEC_QUEUE_ROOT" >> ${JSON.stringify(startedAt)}`,
    'exec sleep 300',
    '',
  ].join('\n'))
  await chmod(script, 0o755)
  return { binDir, startedAt }
}

/** A queue whose fired pass is made to speak on both of its streams: the mergeable TASK the
 *  proof settles, plus two building TASKs whose branches each edit the same capability
 *  file. The shared write hands the pass a relationship to judge, and the settings file
 *  names a judgeBin no machine has, so the judge's run fails at spawn and says so on the
 *  pass's stderr — while the pass itself still completes, its answer on stdout: the
 *  both-streams shape of a pass that runs, without the pass having to fail. No TASK is
 *  queued, so no session ever starts. */
async function makeLogPassQueue(options: { readonly task: string }): Promise<GitRepo> {
  const repo = await makeSettlableTask({
    task: options.task,
    landed: true,
    word: 'mergeable',
    files: {
      'a.txt': 'a',
      'specs/demo.md': '# demo\n\n### Requirement: A demonstrated promise\n\nThe tool SHALL demonstrate.\n',
      '.proofspec/config.json': '{ "judgeBin": "proofspec-no-such-judge" }\n',
    },
  })
  for (const bystander of ['log-second', 'log-third']) {
    await enterTask(repo, bystander, { edit: 'specs/demo.md' })
    await repo.write(`.proofspec/dispatch/${bystander}/state`, 'building')
  }
  return repo
}

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry whose TASK is mergeable and landed, and no PROOFSPEC_QUEUE_ROOT in the environment
// WHEN the registered settle tool's execute runs
// THEN it refuses naming PROOFSPEC_QUEUE_ROOT, and the entry's state still reads mergeable
it('refuses to settle when PROOFSPEC_QUEUE_ROOT is not set, writing nothing', async () => {
  const repo = await makeSettlableTask({ task: 'no-root', landed: true, word: 'mergeable' })
  delete process.env.PROOFSPEC_QUEUE_ROOT
  process.env.PROOFSPEC_TASK = 'no-root'
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeSettleTask('call-1', {}, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_QUEUE_ROOT') })
  expect(await stateOf(repo.root, 'no-root')).toBe('mergeable')
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry whose TASK is mergeable and landed, and no PROOFSPEC_TASK in the environment
// WHEN the registered settle tool's execute runs
// THEN it refuses naming PROOFSPEC_TASK, and the entry's state still reads mergeable
it('refuses to settle when PROOFSPEC_TASK is not set, writing nothing', async () => {
  const repo = await makeSettlableTask({ task: 'no-task', landed: true, word: 'mergeable' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  delete process.env.PROOFSPEC_TASK
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeSettleTask('call-1', {}, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_TASK') })
  expect(await stateOf(repo.root, 'no-task')).toBe('mergeable')
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle for a TASK whose state word is not mergeable is refused, naming the word, and the state, the worktree, and the session stand exactly as they were
// GIVEN a TASK whose branch has landed in the BASE_BRANCH but whose state word reads building, with a worktree standing and a session live
// WHEN the settle runs
// THEN it refuses naming the word building, and the state still reads building, the worktree still stands, and the session is still live
it('refuses a TASK whose state word is not mergeable, leaving everything standing', async () => {
  const repo = await makeSettlableTask({ task: 'not-yet-mergeable', landed: true, word: 'building' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'not-yet-mergeable' })

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('building') })
  expect(await stateOf(repo.root, 'not-yet-mergeable')).toBe('building')
  expect(await worktreeStands(repo.root, 'not-yet-mergeable')).toBe(true)
  await expect(hasSession('not-yet-mergeable')).resolves.toBe(true)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle for a TASK whose branch has not landed in the BASE_BRANCH is refused, naming the branch, and the state, the worktree, and the session stand exactly as they were
// GIVEN a TASK whose state word reads mergeable but whose branch has not landed in the BASE_BRANCH, with a worktree standing and a session live
// WHEN the settle runs
// THEN it refuses as a value naming which condition failed, and the state word, the worktree, and the session stand exactly as they were
it('refuses a TASK whose branch has not landed in the BASE_BRANCH, leaving everything standing', async () => {
  const repo = await makeSettlableTask({ task: 'never-landed', landed: false, word: 'mergeable' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'never-landed' })

  if (result.ok) throw new Error('expected a refusal, got a settle')
  expect(result.reason).toContain('work/never-landed')
  expect(result.reason).toContain('main')
  expect(await stateOf(repo.root, 'never-landed')).toBe('mergeable')
  expect(await worktreeStands(repo.root, 'never-landed')).toBe(true)
  await expect(hasSession('never-landed')).resolves.toBe(true)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle for a mergeable TASK whose branch has landed in the BASE_BRANCH rewrites the state to merged and removes the TASK's worktree
// GIVEN a TASK whose state word reads mergeable and whose branch has landed in the BASE_BRANCH, with a worktree standing at its conventional path
// WHEN the settle runs
// THEN the state word is rewritten to merged and the worktree is removed
it('settles a mergeable TASK whose branch has landed, rewriting the state and removing the worktree', async () => {
  const repo = await makeSettlableTask({ task: 'settled', landed: true, word: 'mergeable' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'settled' }, fireNothing)

  expect(result).toEqual({ ok: true, task: 'settled' })
  expect(await stateOf(repo.root, 'settled')).toBe('merged')
  expect(await worktreeStands(repo.root, 'settled')).toBe(false)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The registered settle tool settles the TASK named by PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK, never the session's own working directory
// GIVEN the environment naming a mergeable, landed TASK, and a session whose own working directory names an unrelated directory
// WHEN the registered settle tool's execute runs
// THEN the TASK named by the environment is settled, and nothing was written under the unrelated directory
it('settles the TASK named by the environment, never the session\'s own working directory', async () => {
  const repo = await makeSettlableTask({ task: 'registered', landed: true, word: 'mergeable' })
  const unrelated = await makeRepo({})
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'registered'
  const fakeContext = { cwd: unrelated.root } as unknown as ExtensionContext

  const result = await executeSettleTask('call-1', {}, undefined, undefined, fakeContext, { fireSchedulingPass: fireNothing })

  expect(result.details).toEqual({ ok: true, task: 'registered' })
  expect(await stateOf(repo.root, 'registered')).toBe('merged')
  expect(await worktreeStands(repo.root, 'registered')).toBe(false)
  // The whole unrelated root, not one path inside it: the claim is that nothing at all was
  // written there, and checking a single file would not hold the tool to that.
  await expect(stat(join(unrelated.root, '.proofspec'))).rejects.toThrow()
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle never prunes the TASK's queue entry
// GIVEN a mergeable, landed TASK with its queue entry standing
// WHEN the settle runs
// THEN the queue entry still stands, holding its MANIFEST and its state word rewritten to merged
it('never prunes the TASK\'s queue entry', async () => {
  const repo = await makeSettlableTask({ task: 'unpruned', landed: true, word: 'mergeable' })

  await runSettleTask({ queueRoot: repo.root, task: 'unpruned' }, fireNothing)

  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'unpruned', 'MANIFEST'), 'utf8')).resolves.toContain('work/unpruned')
  expect(await stateOf(repo.root, 'unpruned')).toBe('merged')
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The settle's session kill is handed to a detached reaper with a short delay, so the settle answers while the session still stands and the kill lands only after the delay
// GIVEN a mergeable, landed TASK with a live tmux session carrying its name on the dedicated server
// WHEN the settle runs in a process of its own, which answers and exits before any kill lands
// THEN the session is still live after that process is gone, and is dead within a few seconds —
//      a kill that outlives the process that scheduled it can only be a detached reaper's
// The settle runs in a child process that exits before the kill lands, because that is the
// one arrangement that tells a detached reaper from an in-process delayed kill: a timer the
// scheduling process owned would die with it, so a kill that lands after its exit is proven
// to belong to some other process. The child hands its own no-op fire — this is an ok
// settle, and no proof of this suite may ever start a real scheduling pass.
it('kills the session through a detached reaper, answering while the session still stands', async () => {
  const repo = await makeSettlableTask({ task: 'reaped', landed: true, word: 'mergeable' })
  const extensionUrl = new URL('../../src/progress/extension.ts', import.meta.url)
  const child = spawn(
    process.execPath,
    [
      '--experimental-transform-types', '--input-type=module', '--eval',
      `const mod = await import(${JSON.stringify(extensionUrl.href)})
       const result = await mod.runSettleTask({ queueRoot: ${JSON.stringify(repo.root)}, task: 'reaped' }, () => {})
       console.log(JSON.stringify(result))`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const answered: string = await new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', chunk => {
      out += chunk
    })
    child.once('error', reject)
    child.once('exit', () => resolve(out.trim()))
  })

  expect(JSON.parse(answered)).toEqual({ ok: true, task: 'reaped' })
  await expect(hasSession('reaped')).resolves.toBe(true)
  await expect(sessionGoneWithin('reaped', 5000)).resolves.toBe(true)
}, 10000)

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A successful settle fires exactly one scheduling pass against the queue root
// GIVEN a mergeable, landed TASK whose settle conditions hold
// WHEN the settle runs and succeeds
// THEN it fires exactly one scheduling pass, run against the queue root
// The queue root reaches the fired pass as its working folder — the plan's one way of
// carrying it — so that is where the proof looks for "against the queue root". The fire is
// the injected recording action, the suite's way: no real pass is ever started here.
it('fires exactly one scheduling pass against the queue root', async () => {
  const repo = await makeSettlableTask({ task: 'fired-once', landed: true, word: 'mergeable' })
  const fired: SchedulingPassPlan[] = []

  const result = await runSettleTask({ queueRoot: repo.root, task: 'fired-once' }, plan => {
    fired.push(plan)
  })

  expect(result).toEqual({ ok: true, task: 'fired-once' })
  expect(fired).toHaveLength(1)
  expect(fired[0]?.cwd).toBe(repo.root)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: No refusal ever fires a scheduling pass
// GIVEN a settle that will refuse — the state word not mergeable, the branch not landed
//      in the BASE_BRANCH, or a settle environment variable unset
// WHEN the settle runs and refuses
// THEN no scheduling pass is fired at all, and the state word, the worktree, and the
//      session stand exactly as they were
// The scenario's GIVEN names three refusal causes, so one proof walks all three; each
// cause keeps its own fixture with its own unique name, because the reaper kills by name.
it('never fires a scheduling pass on a refusal', async () => {
  const fired: SchedulingPassPlan[] = []
  const fire = (plan: SchedulingPassPlan) => {
    fired.push(plan)
  }
  const notMergeable = await makeSettlableTask({ task: 'refused-word', landed: true, word: 'building' })
  const unlanded = await makeSettlableTask({ task: 'refused-branch', landed: false, word: 'mergeable' })
  const noEnv = await makeSettlableTask({ task: 'refused-env', landed: true, word: 'mergeable' })

  const byWord = await runSettleTask({ queueRoot: notMergeable.root, task: 'refused-word' }, fire)
  const byBranch = await runSettleTask({ queueRoot: unlanded.root, task: 'refused-branch' }, fire)
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
  const byEnv = await executeSettleTask('call-3', {}, undefined, undefined, { cwd: noEnv.root } as unknown as ExtensionContext, { fireSchedulingPass: fire })

  expect(byWord.ok).toBe(false)
  expect(byBranch.ok).toBe(false)
  expect(byEnv.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_QUEUE_ROOT') })
  expect(fired).toEqual([])
  expect(await stateOf(notMergeable.root, 'refused-word')).toBe('building')
  expect(await worktreeStands(notMergeable.root, 'refused-word')).toBe(true)
  await expect(hasSession('refused-word')).resolves.toBe(true)
  expect(await stateOf(unlanded.root, 'refused-branch')).toBe('mergeable')
  expect(await worktreeStands(unlanded.root, 'refused-branch')).toBe(true)
  await expect(hasSession('refused-branch')).resolves.toBe(true)
  expect(await stateOf(noEnv.root, 'refused-env')).toBe('mergeable')
  expect(await worktreeStands(noEnv.root, 'refused-env')).toBe(true)
  await expect(hasSession('refused-env')).resolves.toBe(true)
  // Re-asserted after the reads, which pump the event loop: a wrong implementation that
  // deferred the fire past its refusal answer — a timer rather than an inline call — must
  // fail here too, not only at the earlier empty check.
  expect(fired).toEqual([])
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The pass a settle fires is a real scheduling pass of the settle's own proofspec build, run against the queue root and from the queue root, started detached in a process group of its own
// GIVEN a queue holding a mergeable TASK whose branch has landed in the BASE_BRANCH and a
//      released TASK ready to start, in a repo shaped like a consumer's — no `proofspec`
//      script in its `package.json`, proofspec reached the way a consumer reaches it
// WHEN the settle runs and succeeds, firing its one scheduling pass
// THEN the pass really ran — the released TASK was started — the pass being a real
//      `schedule` pass, run against the queue root and from the queue root, started by
//      running the same proofspec build that is running the settle, never through the
//      package manager, detached in a process group of its own
// The real-fire proof the consumer shape demands: the settle runs with its own real fire —
// no injected action — and the pass's own work is observed, nothing else, and no `schedule`
// is ever run by hand. The stand-in `pi` records the session the pass starts, naming the
// TASK and the queue root it was handed — `startSession` receives the pass's own working
// folder as that root, so the one line observes "against the queue root and from the queue
// root" together. The repo holds no `proofspec` script and nothing its package manager
// could resolve to proofspec, so a pass routed through the package manager dies there and
// the released TASK is never started: exactly today's failure, and the observation that
// fails on it.
it("fires a real scheduling pass of its own build in a repo shaped like a consumer's", async () => {
  const stub = await makeStubPi()
  const previousPath = process.env.PATH
  // Set ahead of any tmux command: the throwaway server takes its environment from the
  // first client that starts it, so the stand-in must already be the `pi` that server
  // resolves when the pass starts a session on it.
  process.env.PATH = [stub.binDir, previousPath].join(delimiter)
  try {
    const repo = await makeSettlableTask({
      task: 'real-fire-first',
      landed: true,
      word: 'mergeable',
      files: {
        'a.txt': 'a',
        'second.txt': 'second',
        'specs/demo.md': '# demo\n\n### Requirement: A demonstrated promise\n\nThe tool SHALL demonstrate.\n',
        'package.json': '{ "name": "consumer-shaped", "private": true }\n',
        '.pi/agents/executor.md': 'Placeholder executor. Do nothing.\n',
      },
    })
    await enterTask(repo, 'real-fire-second', {
      edit: 'second.txt',
      blocked: { task: 'real-fire-first', reason: 'waits behind real-fire-first' },
    })
    // Two bystander TASKs sharing one spec file hand the pass a relationship to judge, and
    // the fixture's own judge — a script the settings file names — records the process
    // group it runs in. The judge runs as a plain child of the pass, inheriting the pass's
    // group, so that record is the pass's own group made readable: a pass started detached
    // stands in a group of its own, unlike the group this test process runs in — the
    // behavioral observation of the claim's detachment limb, independent of the command
    // line the pass was started with.
    for (const bystander of ['real-fire-bystander-a', 'real-fire-bystander-b']) {
      await enterTask(repo, bystander, { edit: 'specs/demo.md' })
      await repo.write(`.proofspec/dispatch/${bystander}/state`, 'building')
    }
    const judgePgidAt = join(repo.root, 'judge-pgid.txt')
    const judgeScript = join(repo.root, 'judge-pgid.sh')
    await writeFile(judgeScript, `#!/bin/sh\nps -o pgid= -p \$\$ > ${JSON.stringify(judgePgidAt)}\n`)
    await chmod(judgeScript, 0o755)
    await repo.write('.proofspec/config.json', `${JSON.stringify({ judgeBin: judgeScript })}\n`)
    // The stand-in must be the `pi` every session here resolves — a probe that fails means
    // going on could start a real agent, so the proof stops on it instead.
    const resolvedPi = await execFileAsync('sh', ['-c', 'command -v pi'])
    expect(resolvedPi.stdout, 'the stand-in pi must be the pi a session resolves').toContain(stub.binDir)
    process.env.PROOFSPEC_QUEUE_ROOT = repo.root
    process.env.PROOFSPEC_TASK = 'real-fire-first'

    const result = await executeSettleTask(
      'call-real-fire',
      {},
      undefined,
      undefined,
      { cwd: join(repo.root, '.proofspec', 'worktrees', 'real-fire-first') } as unknown as ExtensionContext,
    )

    expect(result.details).toEqual({ ok: true, task: 'real-fire-first' })
    const started = await textWhenAllMarked(stub.startedAt, ['real-fire-second'])
    // The queue root as the session was handed it — the physical path, because a macOS
    // temp dir sits behind the /var → /private/var symlink and the pass's own cwd reports
    // the resolved one.
    expect(started, 'the fired pass really ran: it started the released TASK, which a pass routed through the package manager never does in a repo with no proofspec script')
      .toBe(`started real-fire-second in ${await realpath(repo.root)}`)
    await expect(stat(join(repo.root, '.proofspec', 'dispatch', 'real-fire-second', 'LEASE'))).resolves.toBeDefined()
    // The detachment limb, read from the record the fixture's judge left: a group of its
    // own is a group no other process stands in, so the pass's group — the one the judge
    // inherited — is not the group this test process (the settle's own host) stands in.
    const judgePgid = await readWhenWritten(judgePgidAt)
    expect(judgePgid, 'the fired pass runs in a process group of its own, reachable by the judge it runs').toBeDefined()
    if (judgePgid !== undefined) {
      const ownPgid = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(process.pid)])
      expect(judgePgid.trim(), 'the pass\u2019s process group is not the settle host\u2019s own').not.toBe(ownPgid.stdout.trim())
    }
  } finally {
    process.env.PATH = previousPath
    await rm(dirname(stub.binDir), { recursive: true, force: true })
  }
}, 30000)

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The first pass a settle fires opens .proofspec/schedule/settle-pass.log with one header line naming the time and the TASK, followed by its stdout and stderr
// GIVEN a mergeable, landed TASK whose successful settle fires its one scheduling pass, and
//      a queue root with no .proofspec/schedule/settle-pass.log standing yet
// WHEN the fired pass runs, writing to its stdout and to its stderr
// THEN the queue root's .proofspec/schedule/settle-pass.log holds one header line that
//      names the time and the TASK whose settle fired the pass, followed by the pass's
//      stdout and its stderr
// The queue gives the pass something to say on both streams (see `makeLogPassQueue`), so
// both limbs are observed on a pass that runs and completes — the same shape a failed
// pass's reason arrives in, without the pass having to fail. The settle runs with its own
// real fire; the log is read only once it holds the pass's own answer, which is written at
// the pass's exit, so anything the pass said before that has already landed.
it("opens the settle-pass log with one header line, then the pass's stdout and stderr", async () => {
  const repo = await makeLogPassQueue({ task: 'log-first-write' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'log-first-write'

  const result = await executeSettleTask('call-log-first', {}, undefined, undefined, { cwd: repo.root } as unknown as ExtensionContext)

  expect(result.details).toEqual({ ok: true, task: 'log-first-write' })
  const logPath = join(repo.root, '.proofspec', 'schedule', 'settle-pass.log')
  const stdoutOfThePass = 'raised capability'
  const stderrOfThePass = 'judge: could not run'
  const log = await textWhenAllMarked(logPath, [stdoutOfThePass, stderrOfThePass])
  expect(log, 'the first fired pass opens the settle-pass log').toBeDefined()
  if (log === undefined) return
  const header = headerNaming(log, 'log-first-write')
  expect(header, "the log's first line is a header naming the TASK").toBeDefined()
  if (header === undefined) return
  expect(log.split('\n')[0]).toBe(header)
  expect(namesRecentTime(header), 'the header names the time').toBe(true)
  expect(countHeaders(log, 'log-first-write'), 'the pass writes exactly one header line').toBe(1)
}, 30000)

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle's fired pass appends its own header line and its stdout and stderr to a standing .proofspec/schedule/settle-pass.log, after what an earlier pass left there
// GIVEN a queue root whose .proofspec/schedule/settle-pass.log already stands, holding what
//      an earlier settle's pass left — its header line and its output
// WHEN another settle fires its one scheduling pass, and that pass runs, writing to its
//      stdout and to its stderr
// THEN the log still holds the earlier pass's header line and output first, followed by
//      the later pass's own header line — naming the time and the TASK whose settle fired
//      it — and that pass's stdout and stderr
// The standing log is given, not re-proven: it holds what an earlier pass left, byte for
// byte, and the proof asks whether the later pass's section lands after it — the branch
// where "appended" and "each pass" bite, since an implementation that truncates the log
// instead loses exactly those earlier bytes.
it("appends the fired pass's header and output after what an earlier pass left in the log", async () => {
  const repo = await makeLogPassQueue({ task: 'log-append' })
  const logPath = join(repo.root, '.proofspec', 'schedule', 'settle-pass.log')
  const earlierPassLeft = '--- 2026-01-01T00:00:00.000Z settle log-earlier ---\nstarted log-earlier\n'
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, earlierPassLeft)
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'log-append'

  const result = await executeSettleTask('call-log-append', {}, undefined, undefined, { cwd: repo.root } as unknown as ExtensionContext)

  expect(result.details).toEqual({ ok: true, task: 'log-append' })
  const stdoutOfThePass = 'raised capability'
  const stderrOfThePass = 'judge: could not run'
  const log = await textWhenAllMarked(logPath, [stdoutOfThePass, stderrOfThePass])
  expect(log, 'the fired pass appends to the standing settle-pass log').toBeDefined()
  if (log === undefined) return
  expect(log.startsWith(earlierPassLeft), 'what the earlier pass left still stands first').toBe(true)
  const appended = log.slice(earlierPassLeft.length)
  const header = headerNaming(appended, 'log-append')
  expect(header, 'the later pass carries its own header line').toBeDefined()
  if (header === undefined) return
  expect(namesRecentTime(header), 'the later header names the time').toBe(true)
  expect(countHeaders(appended, 'log-append'), 'the later pass writes exactly one header line').toBe(1)
  const headerAt = appended.indexOf(header)
  expect(headerAt, 'the later header stands before that pass\u2019s own stdout').toBeLessThan(appended.indexOf(stdoutOfThePass))
  expect(headerAt, 'the later header stands before that pass\u2019s own stderr').toBeLessThan(appended.indexOf(stderrOfThePass))
  expect(appended).toContain(stdoutOfThePass)
  expect(appended).toContain(stderrOfThePass)
}, 30000)

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle starts the scheduling pass with its working folder at the queue root
// GIVEN a mergeable, landed TASK whose successful settle fires its one scheduling pass,
//      and the queue root that TASK's entry lives under
// WHEN the settle runs and succeeds, starting the pass
// THEN the pass is started with its working folder set to the queue root
// The STANDARD promises the working folder as a property of the pass, never naming the
// plan value that carries it, so the proof reads the one fact the fire is handed — the
// working folder — and pins it to the queue root directly. The harsher arrangement, the
// settle's own current folder removed right after the pass starts, is the next scenario's
// own.
it("starts the scheduling pass with its working folder at the queue root", async () => {
  const repo = await makeSettlableTask({ task: 'plan-cwd', landed: true, word: 'mergeable' })
  const fired: SchedulingPassPlan[] = []

  const result = await runSettleTask({ queueRoot: repo.root, task: 'plan-cwd' }, plan => {
    fired.push(plan)
  })

  expect(result).toEqual({ ok: true, task: 'plan-cwd' })
  expect(fired[0]?.cwd).toBe(repo.root)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle whose own current folder is removed right after the pass starts still starts the pass with its working folder set to the queue root, and the pass survives that removal
// GIVEN a mergeable, landed TASK, and a settle whose current folder sits inside the TASK's
//      own worktree — the very folder the settle's teardown removes
// WHEN the settle runs and succeeds, its teardown removing that folder right after the
//      one scheduling pass has started
// THEN the pass it started was started with its working folder set to the queue root —
//      not the settle's own current folder, not any other folder — and it is still
//      running, having survived the removal of that folder
// This is the one proof in the suite that watches a started pass come up, because the
// claim is exactly that: the settle's caller stands inside the TASK's own worktree, the
// teardown deletes that worktree right after the pass starts, and the pass must not
// notice. The started pass is a stand-in, not a real scheduling run — a detached sh that
// records the folder it stands in and then sleeps, started from the plan's working folder
// the way the real fire starts the pass — so where the stand-in stood, and whether it
// outlived the teardown, are the observations. The record is written outside the
// worktree, or the teardown under test would destroy the evidence.
it('starts the pass with its working folder at the queue root, surviving the removal of the settle\'s own current folder', async () => {
  const repo = await makeSettlableTask({ task: 'cwd-removed', landed: true, word: 'mergeable' })
  const worktree = join(repo.root, '.proofspec', 'worktrees', 'cwd-removed')
  const standingAt = join(repo.root, 'stand-in-standing-folder.txt')
  let standIn: ReturnType<typeof spawn> | undefined
  let startFailed: string | undefined
  // The settle runs standing in the worktree — the arrangement the amendment names — so
  // the stand-in's folder is whichever folder the settle's plan pins, or the settle's
  // own when the plan pins none: exactly the difference under test.
  const settleFrom = process.cwd()
  process.chdir(worktree)
  try {
    const result = await runSettleTask({ queueRoot: repo.root, task: 'cwd-removed' }, plan => {
      standIn = spawn('/bin/sh', ['-c', `pwd -P > ${JSON.stringify(standingAt)} && sleep 30`], {
        detached: true,
        stdio: 'ignore',
        cwd: plan.cwd,
      })
      standIn.once('error', error => {
        startFailed = error.message
      })
      standIn.unref()
    })
    expect(result).toEqual({ ok: true, task: 'cwd-removed' })
  } finally {
    process.chdir(settleFrom)
  }

  expect(startFailed).toBeUndefined()
  // `pwd -P` answers the physical path, and a macOS temp dir sits behind the /var →
  // /private/var symlink, so the queue root is asked for its real path before comparing.
  expect(await readWhenWritten(standingAt)).toBe(await realpath(repo.root))
  expect(isRunning(standIn?.pid)).toBe(true)
  standIn?.kill()
}, 10000)
