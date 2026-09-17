// Capability: schedule

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { readRaisedLedger } from '../../src/cli/raised.ts'
import { schedule, renderAnswer } from '../../src/cli/index.ts'
import { judgeWith } from '../../src/schedule/index.ts'
import type { Outcome, RaisedEntry, RelationshipJudgeInput, ScheduleActions, SchedulePlan } from '../../src/cli/index.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'
import type { GitRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)
/** The command's own entry point, run by node the way the `bin` entry does. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))

afterEach(cleanupRepos)
// The bound tests below set PROOFSPEC_MAX_SESSIONS per test; a leaked value would hold every
// later test to some earlier test's bound, the same ambient leak the socket override keeps
// its own cleanup for.
afterEach(() => {
  delete process.env.PROOFSPEC_MAX_SESSIONS
})

// A pass settles a mergeable TASK by tearing down its session — killing a tmux session by the
// TASK's name and removing its worktree. Pointing the whole suite at a throwaway socket keeps
// that kill from ever reaching a real session on the production socket, the exact override
// PROOFSPEC_TMUX_SOCKET exists to provide.
process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run'

function planOf(outcome: Outcome): SchedulePlan {
  if (outcome.kind !== 'scheduled') throw new Error(`expected a scheduled report, got ${outcome.kind}`)
  return outcome.report
}

/** Starting sessions in order, on a plain in-memory list — a real session is a headed, interactive
 * process this suite never starts; what a pass decided to start is what these tests check. The
 * live count answers zero unless a test overrides it, so a pass is never bound by default. */
function fakeActions(overrides: Partial<ScheduleActions> = {}): ScheduleActions & { readonly startedSessions: string[] } {
  const startedSessions: string[] = []
  return {
    startedSessions,
    startSession: async task => {
      startedSessions.push(task)
    },
    countSessions: async () => 0,
    judge: async () => ({ kind: 'resolved' }),
    notifyHuman: async () => {},
    ...overrides,
  }
}

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A ready TASK starts a session and takes a LEASE
// GIVEN a queued TASK based on main
// WHEN a scheduling pass runs
// THEN the TASK's session starts exactly once, and a LEASE now stands for it
it('starts a session for a ready TASK and takes its LEASE', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions()

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.started).toEqual(['a'])
  expect(actions.startedSessions).toEqual(['a'])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'LEASE'), 'utf8')).resolves.not.toBe('')
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: The real command blocks a second pass from starting a second session for a ready TASK
// GIVEN a queued TASK a first scheduling pass already dispatched
// WHEN a second pass runs immediately after, before the TASK's state has moved
// THEN the second pass starts no session for it, and reports it blocked instead
it('does not start a second session on a second pass over the same ready TASK', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions()

  await schedule({ cwd: repo.root, schedule: actions })
  const second = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(actions.startedSessions).toEqual(['a'])
  expect(second.started).toEqual([])
  expect(second.blocked).toEqual(['a'])
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: Two passes racing at the same instant still start exactly one session
// GIVEN a queued TASK, and two scheduling passes launched at the same instant rather than
//       one after the other
// WHEN both race to take the LEASE
// THEN exactly one session starts for it, never zero and never two
it('starts exactly one session when two passes race at the same instant', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions()

  const [first, second] = await Promise.all([
    schedule({ cwd: repo.root, schedule: actions }),
    schedule({ cwd: repo.root, schedule: actions }),
  ])

  expect(actions.startedSessions).toEqual(['a'])
  expect([...planOf(first).started, ...planOf(second).started]).toEqual(['a'])
})

// Requirement: A stale LEASE is told apart from a live one by elapsed time, not by probing a process
// Scenario: A pass after the grace period reclaims a LEASE nothing advanced past
// GIVEN a queued TASK whose LEASE was taken longer ago than the grace period, its state never
//       having advanced to building
// WHEN a scheduling pass runs
// THEN the TASK's session starts again
it('reclaims a stale LEASE and starts the session again', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions()
  const past = new Date(Date.now() - 60 * 60 * 1000)

  await schedule({ cwd: repo.root, schedule: actions, now: past })
  const later = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(actions.startedSessions).toEqual(['a', 'a'])
  expect(later.started).toEqual(['a'])
})

// Requirement: A stale LEASE is told apart from a live one by elapsed time, not by probing a process
// Scenario: Two passes racing to reclaim the same stale LEASE still start exactly one session
// GIVEN a queued TASK whose LEASE has gone stale
// WHEN two scheduling passes race to reclaim it at the same instant rather than one after another
// THEN exactly one session starts for it, never zero and never two
it('reclaims a stale LEASE exactly once when two passes race to reclaim it', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions()
  const past = new Date(Date.now() - 60 * 60 * 1000)
  await schedule({ cwd: repo.root, schedule: actions, now: past })
  actions.startedSessions.splice(0)

  const [first, second] = await Promise.all([
    schedule({ cwd: repo.root, schedule: actions }),
    schedule({ cwd: repo.root, schedule: actions }),
  ])

  expect(actions.startedSessions).toEqual(['a'])
  expect([...planOf(first).started, ...planOf(second).started]).toEqual(['a'])
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK held on a still in-flight TASK is not dispatched
// GIVEN a queued TASK whose base names another TASK that is itself still in flight
// WHEN a scheduling pass runs
// THEN the held TASK's session does not start
it('does not dispatch a TASK held on a TASK that is still live', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })
  const actions = fakeActions()

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.started).toContain('a')
  expect(plan.started).not.toContain('b')
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A TASK held on a TASK that has since merged is dispatched
// GIVEN a queued TASK whose base names a TASK whose own state has reached merged
// WHEN a scheduling pass runs
// THEN the previously held TASK's session starts
it('dispatches a TASK once the TASK it was held on has merged', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/b.md': '# b\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')
  await enterTask(repo, 'b', { edit: 'specs/b.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })
  const actions = fakeActions()

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.started).toEqual(['b'])
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// GIVEN a TASK whose state word is mergeable, whose branch has already landed in main
// WHEN a scheduling pass runs
// THEN the TASK is reported settled, its state word rewritten to merged and its entry pruned
//      in the same pass
it('rewrites a mergeable TASK to merged once its branch has landed in main', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await repo.git(['merge', 'work/a'])
  await repo.write('.proofspec/dispatch/a/state', 'mergeable')

  const outcome = await schedule({ cwd: repo.root, schedule: fakeActions() })

  expect(planOf(outcome).merged).toEqual(['a'])
  expect(planOf(outcome).pruned).toEqual(['a'])
  expect(renderAnswer(outcome)).toContain('merged a')
  const remaining = await readdir(join(repo.root, '.proofspec', 'dispatch'))
  expect(remaining).not.toContain('a')
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A mergeable TASK whose branch has not landed in main keeps its state word exactly as it stands
// GIVEN a TASK whose state word is mergeable, whose branch has not landed in main
// WHEN a scheduling pass runs
// THEN the TASK's state file still reads mergeable, and the pass settles nothing
it('keeps a mergeable TASK\'s state word when its branch has not landed', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await repo.write('.proofspec/dispatch/a/state', 'mergeable')

  const plan = planOf(await schedule({ cwd: repo.root, schedule: fakeActions() }))

  expect(plan.merged).toEqual([])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('mergeable')
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A TASK whose branch has landed but whose word is not mergeable keeps its state word exactly as it stands
// GIVEN a TASK whose branch has landed in main, whose state word is building — the executor\'s
//      own word for a session still live
// WHEN a scheduling pass runs
// THEN the TASK's state file still reads building — a landed branch alone never settles a TASK
it('keeps a landed TASK\'s state word when it is not mergeable', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await repo.git(['merge', 'work/a'])
  await repo.write('.proofspec/dispatch/a/state', 'building')

  const plan = planOf(await schedule({ cwd: repo.root, schedule: fakeActions() }))

  expect(plan.merged).toEqual([])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('building')
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: The pass's settle kills the TASK's session through the reaper, so the pass has already answered when the kill lands
// GIVEN a mergeable TASK whose branch has landed in main, with a live tmux session carrying its name on the dedicated server
// WHEN a scheduling pass runs and answers
// THEN the session is still live at the moment the pass answers, and is gone within a few seconds after
// The task name is unique in this suite because the reaper kills by that name: a shared name
// would let another test's reaper kill this test's fresh session inside the reaper's delay.
it('kills the settled TASK\'s session through the reaper, after the pass has answered', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'pass-reaped', { edit: 'specs/cli.md' })
  await repo.git(['merge', 'work/pass-reaped'])
  await repo.write('.proofspec/dispatch/pass-reaped/state', 'mergeable')
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'pass-reaped'), 'work/pass-reaped'])
  const tmux = (args: readonly string[]) => execFileAsync('tmux', ['-L', 'proofspec-test-run', ...args])
  await tmux(['new-session', '-d', '-s', 'pass-reaped', 'sleep', '60'])
  const hasSession = () => tmux(['has-session', '-t', 'pass-reaped']).then(() => true, () => false)
  try {
    const plan = planOf(await schedule({ cwd: repo.root, schedule: fakeActions() }))

    expect(plan.merged).toEqual(['pass-reaped'])
    await expect(hasSession()).resolves.toBe(true)
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && (await hasSession())) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await expect(hasSession()).resolves.toBe(false)
  } finally {
    await tmux(['kill-server']).catch(() => {})
  }
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: The landed-in-main check is made fresh from git on each pass, never from bookkeeping
// GIVEN a TASK whose state word is mergeable, whose branch has not yet landed in main
// WHEN a first pass runs, then the branch is merged into main, then a second pass runs
// THEN the first pass settles nothing, and the second settles it — the same pass shape answers
//      differently once git alone has changed
it('checks the landed-in-main question fresh from git on each pass', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await repo.write('.proofspec/dispatch/a/state', 'mergeable')
  const actions = fakeActions()

  const before = planOf(await schedule({ cwd: repo.root, schedule: actions }))
  expect(before.merged).toEqual([])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('mergeable')

  await repo.git(['merge', 'work/a'])
  const after = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(after.merged).toEqual(['a'])
  const remaining = await readdir(join(repo.root, '.proofspec', 'dispatch'))
  expect(remaining).not.toContain('a')
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A TASK held on a mergeable TASK whose branch has landed is dispatched by the same pass that settles it
// GIVEN a TASK based on another whose state word is mergeable and whose branch has landed in main
// WHEN a scheduling pass runs
// THEN the pass settles the held-on TASK, and dispatches the held TASK in that same pass — the
//      hold never outlives the state word it reads
it('dispatches a TASK held on a mergeable TASK whose branch has landed, in the same pass', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/b.md': '# b\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await enterTask(repo, 'b', { edit: 'specs/b.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })
  await repo.git(['merge', 'work/a'])
  await repo.write('.proofspec/dispatch/a/state', 'mergeable')
  const actions = fakeActions()

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.merged).toEqual(['a'])
  expect(plan.started).toEqual(['b'])
  // b's base still names a, so a's entry survives this pass to answer for the hold — and its
  // state word is the one this pass wrote, not the one it found.
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('merged')
})

// Requirement: A merged TASK's queue entry is pruned once nothing still names it
// Scenario: A merged TASK nothing still names is pruned from the queue directory
// GIVEN a merged TASK no in-flight TASK's base names
// WHEN a scheduling pass runs
// THEN that TASK's whole queue entry is gone from disk — not just one file inside it
it('prunes a merged TASK nothing still names from the queue directory', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')

  const plan = planOf(await schedule({ cwd: repo.root, schedule: fakeActions() }))

  expect(plan.pruned).toEqual(['a'])
  const remaining = await readdir(join(repo.root, '.proofspec', 'dispatch'))
  expect(remaining).not.toContain('a')
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'MANIFEST'), 'utf8')).rejects.toThrow()
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).rejects.toThrow()
})

// Requirement: A merged TASK's queue entry is pruned once nothing still names it
// Scenario: A merged TASK an in-flight TASK still names is kept
// GIVEN a merged TASK, and an in-flight TASK whose base still names it
// WHEN a scheduling pass runs
// THEN that TASK's queue entry is still on disk
it('does not prune a merged TASK an in-flight TASK still names', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/b.md': '# b\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')
  await enterTask(repo, 'b', { edit: 'specs/b.md', onto: 'work/a', base: { kind: 'task', task: 'a', reason: "needs a's work" } })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: fakeActions() }))

  expect(plan.pruned).toEqual([])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('merged')
})

/** Writes a real intent document at the path every fixture MANIFEST names (`docs/x.md`), on the
 * TASK's own branch — each TASK's branch holds its own copy, so the two never collide. */
async function withIntent(repo: GitRepo, branch: string, intent: string): Promise<void> {
  await repo.git(['checkout', branch])
  await repo.write('docs/x.md', intent)
  await repo.git(['add', 'docs/x.md'])
  await repo.git(['commit', '-m', 'intent'])
  await repo.git(['checkout', 'main'])
}

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A relationship the fresh agent resolves is never raised
// GIVEN two TASK sharing a capability file, whose real intent a fresh agent reads and judges
//       to be no real conflict
// WHEN a scheduling pass runs
// THEN no relationship is raised, and no human is notified
it('never raises a relationship the fresh agent resolves', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  await withIntent(repo, 'work/a', 'renames a helper function')
  await withIntent(repo, 'work/b', 'fixes an unrelated typo')
  let notified = 0
  const actions = fakeActions({ judge: async () => ({ kind: 'resolved' }), notifyHuman: async () => { notified += 1 } })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.raised).toEqual([])
  expect(notified).toBe(0)
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: The fresh agent is handed both TASKs' real intent
// GIVEN two TASK sharing a capability file, each with its own real intent document
// WHEN a scheduling pass runs
// THEN the judge is handed both TASKs' intent text, exactly as written
it("hands the judge both TASKs' real intent", async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  await withIntent(repo, 'work/a', 'renames a helper function')
  await withIntent(repo, 'work/b', 'fixes an unrelated typo')
  const seen: RelationshipJudgeInput[] = []
  const actions = fakeActions({
    judge: async input => {
      seen.push(input)
      return { kind: 'resolved' }
    },
  })

  await schedule({ cwd: repo.root, schedule: actions })

  expect(seen).toHaveLength(1)
  expect(seen[0]?.intents).toEqual({ a: 'renames a helper function', b: 'fixes an unrelated typo' })
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: The reserved INTENT name reads the TASK's intent from its own queue entry, a path value from the branch
// GIVEN two TASK sharing a capability file, one whose MANIFEST's intentRef is the reserved
//       name INTENT with its intent standing in its queue entry's INTENT file, the other
//       whose intentRef names a file on its own branch
// WHEN a scheduling pass runs
// THEN the judge is handed the queue entry's intent text and the branch file's intent text,
//      each exactly as written
it("reads a reserved INTENT intentRef from the queue entry and a path value from the branch", async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  await withIntent(repo, 'work/a', 'rewrites the glossary term')
  await repo.write('.proofspec/dispatch/b/MANIFEST', JSON.stringify({ intentRef: 'INTENT', branch: 'work/b', base: { kind: 'main' } }))
  await repo.write('.proofspec/dispatch/b/INTENT', 'rewrites the executor persona')
  const seen: RelationshipJudgeInput[] = []
  const actions = fakeActions({
    judge: async input => {
      seen.push(input)
      return { kind: 'resolved' }
    },
  })

  await schedule({ cwd: repo.root, schedule: actions })

  expect(seen).toHaveLength(1)
  expect(seen[0]?.intents).toEqual({ a: 'rewrites the glossary term', b: 'rewrites the executor persona' })
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A scheduling pass built from the composed judge factory raises what it judges unresolved
// GIVEN two TASK sharing a capability file, and a judge built from the composed judge factory
//       over a stand-in runner that answers unresolved
// WHEN a scheduling pass runs
// THEN that relationship is raised
it('raises what the composed judge factory judges unresolved', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  const judge = judgeWith(async () => ({ kind: 'ran' as const, code: 0, stdout: 'UNRESOLVED' }), { model: 'zai/glm-5.3:low' })
  const actions = fakeActions({ judge })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.raised).toHaveLength(1)
})

// Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably
// Scenario: A relationship the fresh agent could not resolve is raised to a human
// GIVEN two TASK sharing a capability file, whose relationship the fresh agent cannot resolve
// WHEN a scheduling pass runs
// THEN that relationship is raised, and the human is notified of it
it('raises a relationship the fresh agent could not resolve', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  const notified: string[][] = []
  const actions = fakeActions({
    judge: async () => ({ kind: 'unresolved' }),
    notifyHuman: async relationship => {
      notified.push([...relationship.tasks])
    },
  })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.raised).toHaveLength(1)
  expect(notified).toEqual([['a', 'b']])
})

// Requirement: The same finding is not raised to a human twice
// Scenario: A relationship already raised is not raised again by a later pass
// GIVEN two TASK sharing a capability file whose relationship a first pass already raised
// WHEN a second pass recomputes the same graph
// THEN the second pass raises nothing, and does not notify the human again
it('does not raise the same relationship twice across passes', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  let notifications = 0
  const actions = fakeActions({
    judge: async () => ({ kind: 'unresolved' }),
    notifyHuman: async () => {
      notifications += 1
    },
  })

  await schedule({ cwd: repo.root, schedule: actions })
  const second = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(notifications).toBe(1)
  expect(second.raised).toEqual([])
})

// Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably
// Scenario: A recorded ruling traces to exactly the text given
// GIVEN a relationship already raised
// WHEN a human's ruling is recorded
// THEN the durable record holds that exact text, not anything the fresh agent produced
it("records a human's ruling as exactly the text given", async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  const actions = fakeActions({ judge: async () => ({ kind: 'unresolved' }) })
  await schedule({ cwd: repo.root, schedule: actions })
  const raisedBefore = await readRaisedLedger(repo.root)
  const key = raisedBefore[0]?.key
  if (key === undefined) throw new Error('expected a raised entry')

  const outcome = await schedule({ cwd: repo.root, ruling: { key, ruling: 'go ahead, they never touch the same lines' } })

  expect(outcome.kind).toBe('ruled')
  const entries = await readRaisedLedger(repo.root)
  const ruled = entries.find((entry): entry is RaisedEntry & { readonly kind: 'ruled' } => entry.kind === 'ruled' && entry.key === key)
  expect(ruled?.ruling).toBe('go ahead, they never touch the same lines')
})

// Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably
// Scenario: The real command line records a ruling through its one positional and --ruling
// GIVEN a relationship already raised
// WHEN the real `proofspec schedule <key> --ruling <text>` command line is run as a process
// THEN the durable record holds that exact text
it("records a human's ruling through the real command line's --ruling flag", async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  const actions = fakeActions({ judge: async () => ({ kind: 'unresolved' }) })
  await schedule({ cwd: repo.root, schedule: actions })
  const raisedBefore = await readRaisedLedger(repo.root)
  const key = raisedBefore[0]?.key
  if (key === undefined) throw new Error('expected a raised entry')

  await execFileAsync(process.execPath, ['--experimental-transform-types', MAIN, 'schedule', key, '--ruling', 'settled on the command line'], {
    cwd: repo.root,
  })

  const entries = await readRaisedLedger(repo.root)
  const ruled = entries.find((entry): entry is RaisedEntry & { readonly kind: 'ruled' } => entry.kind === 'ruled' && entry.key === key)
  expect(ruled?.ruling).toBe('settled on the command line')
})

// Requirement: A scheduling pass is triggered by events, not a resident process or a timer
// Scenario: A later pass does not repeat work an earlier pass already did
// GIVEN a repository with one ready TASK and one unresolved relationship
// WHEN two scheduling passes run back to back with nothing changed in between
// THEN the second pass prunes nothing already pruned, starts no session the first pass already
//      started, and raises nothing the first pass already raised
it('does not repeat pruning, dispatching, or raising across two passes run back to back', async () => {
  const repo = await makeGitRepo({ 'specs/a.md': '# a\n', 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/a.md' })
  await repo.write('.proofspec/dispatch/a/state', 'merged')
  await enterTask(repo, 'c', { edit: 'specs/cli.md' })
  await enterTask(repo, 'd', { edit: 'specs/cli.md' })
  const actions = fakeActions({ judge: async () => ({ kind: 'unresolved' }) })

  const first = planOf(await schedule({ cwd: repo.root, schedule: actions }))
  const second = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(first.pruned).toEqual(['a'])
  expect(second.pruned).toEqual([])
  expect([...first.started].sort()).toEqual(['c', 'd'])
  expect(second.started).toEqual([])
  expect([...second.blocked].sort()).toEqual(['c', 'd'])
  expect(first.raised).toHaveLength(1)
  expect(second.raised).toEqual([])
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A ready TASK with no startSession action given cannot run
// GIVEN a queued, ready TASK
// WHEN a scheduling pass runs with no startSession action given
// THEN the pass reports it cannot run, rather than silently doing nothing
it('cannot run a pass with a ready TASK and no startSession action', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })

  const outcome = await schedule({ cwd: repo.root })

  expect(outcome.kind).toBe('cannot-run')
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A scheduling pass starts no session once the live count has reached the bound
// GIVEN a queued, ready TASK, a bound of one, and one executor session already live
// WHEN a scheduling pass runs
// THEN no session starts for it and the pass reports it deferred — never dispatched past the bound
it('starts no session once the live count has reached the bound', async () => {
  process.env.PROOFSPEC_MAX_SESSIONS = '1'
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions({ countSessions: async () => 1 })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.started).toEqual([])
  expect(plan.deferred).toEqual(['a'])
  expect(actions.startedSessions).toEqual([])
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A TASK the bound leaves undispatched keeps its state word queued exactly as it stands
// GIVEN a queued TASK the bound has left undispatched
// WHEN the pass that deferred it has finished
// THEN its state file still reads queued exactly as it stood — only the machine's capacity
//      changed, and capacity is no state of the TASK's own
it('keeps a TASK the bound leaves undispatched queued exactly as it stands', async () => {
  process.env.PROOFSPEC_MAX_SESSIONS = '1'
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  const actions = fakeActions({ countSessions: async () => 1 })

  await schedule({ cwd: repo.root, schedule: actions })

  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('queued')
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A later pass dispatches a TASK the bound deferred once a session has gone
// GIVEN a TASK the bound deferred, and then the session count dropping below the bound
// WHEN a later scheduling pass runs
// THEN that pass dispatches it — the deferral took no LEASE, so nothing of the earlier pass
//      stands in the later one's way
it('dispatches a TASK the bound deferred once a session has gone', async () => {
  process.env.PROOFSPEC_MAX_SESSIONS = '1'
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  let live = 1
  const actions = fakeActions({ countSessions: async () => live })

  const deferred = planOf(await schedule({ cwd: repo.root, schedule: actions }))
  expect(deferred.deferred).toEqual(['a'])
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'LEASE'), 'utf8')).rejects.toThrow()

  live = 0
  const later = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(later.started).toEqual(['a'])
  expect(actions.startedSessions).toEqual(['a'])
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: The live count is taken fresh at each dispatch decision, so one pass fills the bound TASK by TASK
// GIVEN three ready TASKs, a bound of two, and a live count that grows by one each time it is asked
// WHEN one scheduling pass dispatches them
// THEN it starts exactly two sessions — asking the count anew before each — and defers the third,
//      rather than counting once and dispatching all three past the bound
it('takes the live count fresh at each dispatch decision within one pass', async () => {
  process.env.PROOFSPEC_MAX_SESSIONS = '2'
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })
  await enterTask(repo, 'b', { edit: 'specs/cli.md' })
  await enterTask(repo, 'c', { edit: 'specs/cli.md' })
  let asked = 0
  const actions = fakeActions({
    countSessions: async () => {
      asked += 1
      return asked - 1
    },
  })

  const plan = planOf(await schedule({ cwd: repo.root, schedule: actions }))

  expect(plan.started).toEqual(['a', 'b'])
  expect(plan.deferred).toEqual(['c'])
})

// Requirement: No executor session starts once the live-session bound is reached
// Scenario: A ready TASK with no countSessions action given cannot run the pass
// GIVEN a queued, ready TASK
// WHEN a scheduling pass runs with a startSession action but no countSessions action
// THEN the pass reports it cannot run — a pass that cannot count live sessions cannot honor
//      the bound, and dispatching unbounded is not a failure it is allowed to swallow
it('cannot run a pass with a ready TASK and no countSessions action', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(repo, 'a', { edit: 'specs/cli.md' })

  const outcome = await schedule({
    cwd: repo.root,
    schedule: { startSession: async () => {}, judge: async () => ({ kind: 'resolved' }) },
  })

  expect(outcome.kind).toBe('cannot-run')
})

// Requirement: A scheduling pass is triggered by events, not a resident process or a timer
// Scenario: A pass over an empty queue answers with nothing to do, needing no actions at all
// GIVEN a repository with no TASK in the queue
// WHEN a scheduling pass runs with no actions given at all
// THEN it succeeds, reporting nothing to do
it('reports nothing to do for an empty queue, needing no actions at all', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })

  const outcome = await schedule({ cwd: repo.root })

  expect(outcome.kind).toBe('scheduled')
  expect(renderAnswer(outcome)).toContain('nothing to do')
})
