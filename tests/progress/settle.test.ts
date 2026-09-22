// Capability: progress

import { execFile, spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { schedulingPassFor } from '../../src/cli/settle.ts'
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
async function makeSettlableTask(options: { readonly task: string; readonly landed: boolean; readonly word: string }): Promise<GitRepo> {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, options.task, { edit: 'a.txt' })
  if (options.landed) await repo.git(['merge', `work/${options.task}`])
  await repo.write(`.proofspec/dispatch/${options.task}/state`, options.word)
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', options.task), `work/${options.task}`])
  await execFileAsync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', options.task, 'sleep', '60'])
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
  const repo = await makeSettlableTask({ task: 'still-building', landed: true, word: 'building' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'still-building' })

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('building') })
  expect(await stateOf(repo.root, 'still-building')).toBe('building')
  expect(await worktreeStands(repo.root, 'still-building')).toBe(true)
  await expect(hasSession('still-building')).resolves.toBe(true)
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

  const result = await executeSettleTask('call-1', {}, undefined, undefined, fakeContext, fireNothing)

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
// Scenario: A successful settle fires one scheduling pass against the queue root, after the state word is rewritten and before the teardown
// GIVEN a TASK whose state word reads mergeable and whose branch has landed in the
// BASE_BRANCH, with its worktree standing and its session live
// WHEN the settle runs and succeeds
// THEN it fires exactly one scheduling pass against the queue root — fired after the
//      state word already reads merged, while the worktree still stands and the session is
//      still live
// The ordering claim is observed from inside the fire itself: the injected action reads
// the queue, the worktree path, and the session at the moment it is handed control, so
// what each read returned is the proof of where in the settle's order the fire landed.
it('fires one scheduling pass against the queue root, after the state word and before the teardown', async () => {
  const repo = await makeSettlableTask({ task: 'fired-once', landed: true, word: 'mergeable' })
  const observed: { plan: SchedulingPassPlan; state: string; worktree: boolean; session: boolean }[] = []

  const result = await runSettleTask({ queueRoot: repo.root, task: 'fired-once' }, async plan => {
    observed.push({
      plan,
      state: await stateOf(repo.root, 'fired-once'),
      worktree: await worktreeStands(repo.root, 'fired-once'),
      session: await hasSession('fired-once'),
    })
  })

  expect(result).toEqual({ ok: true, task: 'fired-once' })
  expect(observed).toHaveLength(1)
  expect(observed[0]?.plan.args).toContain(repo.root)
  expect(observed[0]?.state).toBe('merged')
  expect(observed[0]?.worktree).toBe(true)
  expect(observed[0]?.session).toBe(true)
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
  const byEnv = await executeSettleTask('call-3', {}, undefined, undefined, { cwd: noEnv.root } as unknown as ExtensionContext, fire)

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
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The pass a settle fires is the merge hooks' own scheduling command, started so the settle's teardown cannot take it with it
// GIVEN a mergeable, landed TASK whose successful settle fires its one scheduling pass
// WHEN the pass starts and the settle's teardown follows — the session killed by the
//      delayed reaper, which takes the session's process group with it
// THEN the pass is still running: it was started as the same scheduling command the
//      merge hooks run, in a process group of its own the kill never reached
// The survival claim is proven as a plan value, the way the reaper's own already is
// (`reaperFor`/`ReaperPlan`, src/cli/session.ts): a detached spawn — a process group of
// its own — is the one thing the reaper's group-kill cannot reach, so a pass started from
// a plan naming `detached: true` is still running after the teardown has taken the
// session's group. No pass is ever started by this proof; it asserts what the fire is
// handed — the hooks' own command line, against the queue root, as the exported seam's
// own value.
it('fires the merge hooks\' own scheduling command, detached so the teardown cannot take it with it', async () => {
  const repo = await makeSettlableTask({ task: 'hooks-command', landed: true, word: 'mergeable' })
  const fired: SchedulingPassPlan[] = []

  const result = await runSettleTask({ queueRoot: repo.root, task: 'hooks-command' }, plan => {
    fired.push(plan)
  })

  expect(result).toEqual({ ok: true, task: 'hooks-command' })
  expect(fired).toEqual([schedulingPassFor(repo.root)])
  expect(fired[0]).toEqual({ command: 'pnpm', args: ['--dir', repo.root, 'proofspec', 'schedule'], detached: true })
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: A settle whose scheduling pass cannot even be started still succeeds, reporting the failure as a finding
// GIVEN a mergeable, landed TASK, and a scheduling pass whose start fails outright
// WHEN the settle runs
// THEN it still answers as a success — the state rewritten to merged, the worktree
//      removed, the session handed to the reaper — with the failed start reported as a
//      finding, never as the settle's own refusal
// The observable shape chosen for "reported as a finding": the ok answer itself carries
// it — an optional `finding` on the settle's ok limb, present only when the pass could not
// be started — so the failure is assertable rather than swallowed, and the settle's own
// ok/refuse contract answers the landing untouched.
it('still succeeds when its scheduling pass cannot even be started, reporting the failure as a finding', async () => {
  const repo = await makeSettlableTask({ task: 'unstartable-pass', landed: true, word: 'mergeable' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'unstartable-pass' }, () => {
    throw new Error('spawn pnpm ENOENT')
  })

  expect(result).toEqual({ ok: true, task: 'unstartable-pass', finding: expect.stringContaining('spawn pnpm ENOENT') })
  expect(await stateOf(repo.root, 'unstartable-pass')).toBe('merged')
  expect(await worktreeStands(repo.root, 'unstartable-pass')).toBe(false)
  // Handed to the reaper, not killed inline: the session still stands the moment the
  // settle has answered — the kill lands only after the reaper's delay.
  await expect(hasSession('unstartable-pass')).resolves.toBe(true)
})
