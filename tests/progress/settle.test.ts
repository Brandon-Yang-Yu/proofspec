// Capability: progress

import { execFile, spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
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
// GIVEN a TASK whose branch has landed in main but whose state word reads building, with a worktree standing and a session live
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
// Scenario: A settle for a TASK whose branch has not landed in main is refused, naming the branch, and the state, the worktree, and the session stand exactly as they were
// GIVEN a TASK whose state word reads mergeable but whose branch has not landed in main, with a worktree standing and a session live
// WHEN the settle runs
// THEN it refuses naming the branch, and the state still reads mergeable, the worktree still stands, and the session is still live
it('refuses a TASK whose branch has not landed in main, leaving everything standing', async () => {
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
// Scenario: A settle for a mergeable TASK whose branch has landed in main rewrites the state to merged and removes the TASK's worktree
// GIVEN a TASK whose state word reads mergeable and whose branch has landed in main, with a worktree standing at its conventional path
// WHEN the settle runs
// THEN the entry's state file reads merged, and nothing stands at the worktree's conventional path
it('settles a mergeable TASK whose branch has landed, rewriting the state and removing the worktree', async () => {
  const repo = await makeSettlableTask({ task: 'settled', landed: true, word: 'mergeable' })

  const result = await runSettleTask({ queueRoot: repo.root, task: 'settled' })

  expect(result).toEqual({ ok: true, task: 'settled' })
  expect(await stateOf(repo.root, 'settled')).toBe('merged')
  expect(await worktreeStands(repo.root, 'settled')).toBe(false)
})

// Requirement: settle_task settles a TASK only after re-verifying its landing from git
// Scenario: The registered settle tool settles the TASK named by PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK, never ExtensionContext.cwd
// GIVEN the environment naming a mergeable, landed TASK, and an ExtensionContext whose cwd names an unrelated directory
// WHEN the registered settle tool's execute runs
// THEN the TASK named by the environment is settled, and nothing was written under the unrelated directory
it('settles the TASK named by the environment, never ExtensionContext.cwd', async () => {
  const repo = await makeSettlableTask({ task: 'registered', landed: true, word: 'mergeable' })
  const unrelated = await makeRepo({})
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'registered'
  const fakeContext = { cwd: unrelated.root } as unknown as ExtensionContext

  const result = await executeSettleTask('call-1', {}, undefined, undefined, fakeContext)

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

  await runSettleTask({ queueRoot: repo.root, task: 'unpruned' })

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
// to belong to some other process.
it('kills the session through a detached reaper, answering while the session still stands', async () => {
  const repo = await makeSettlableTask({ task: 'reaped', landed: true, word: 'mergeable' })
  const extensionUrl = new URL('../../src/progress/extension.ts', import.meta.url)
  const child = spawn(
    process.execPath,
    [
      '--experimental-transform-types', '--input-type=module', '--eval',
      `const mod = await import(${JSON.stringify(extensionUrl.href)})
       const result = await mod.runSettleTask({ queueRoot: ${JSON.stringify(repo.root)}, task: 'reaped' })
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
