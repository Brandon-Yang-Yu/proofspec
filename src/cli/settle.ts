import { baseBranch } from '../base-branch.ts'
import { MERGEABLE } from '../schedule/types.ts'
import { isAncestor } from './git.ts'
import { manifestFor, readState, writeState } from './queue.ts'
import { teardownTask } from './session.ts'

/**
 * Requirements: settle_task settles a TASK only after re-verifying its landing from git
 * (specs/progress.md) / A scheduling pass rewrites a mergeable TASK's state to merged once
 * its branch has landed in the BASE_BRANCH (specs/schedule.md)
 *
 * The one settle, two callers: the `settle_task` tool an executor session calls the moment
 * its own merge lands, and the scheduling pass that keeps running the same check as a
 * backstop for a TASK the tool never settles. Neither is trusted on its word — a session
 * that just did the merging is the least impartial judge of whether the merge landed — so
 * both conditions are answered here, fresh, on every call: the state word read back from the
 * queue, the ancestry asked of git. Pruning the queue entry afterwards is *not* part of this
 * settle: which in-flight TASKs still name an entry is a fact about the whole queue one
 * session cannot answer, and it stays the pass's own move.
 */

/** What a settle answers its caller: it happened — carrying a finding only when the
 *  scheduling pass a successful settle fires could not even be started — or the reason it
 *  refused — never a throw. */
export type SettleResult =
  | { readonly ok: true; readonly task: string; readonly finding?: string }
  | { readonly ok: false; readonly reason: string }

/** The one scheduling pass a successful settle fires against the queue root: the same
 *  command the merge hooks run — `pnpm --dir <queue root> proofspec schedule`
 *  (`.githooks/post-merge`) — carried as a pure plan value the way the reaper's is
 *  (`reaperFor`/`ReaperPlan`, `src/cli/session.ts`), so a proof can check which command a
 *  settle fires, and how it is started, without ever starting it. */
export type SchedulingPassPlan = {
  readonly command: 'pnpm'
  readonly args: readonly ['--dir', string, 'proofspec', 'schedule']
  /** The process-group escape: the pass is started detached, in a process group of its
   *  own, so the delayed reaper's group-kill — the one that takes the settle's own session
   *  — cannot reach it. The escape is the point, not spawn syntax. */
  readonly detached: true
}

/** The pass a settle fires for `queueRoot`: the merge hooks' own scheduling command, run
 *  against that root, detached so it survives the settle's teardown. */
export function schedulingPassFor(queueRoot: string): SchedulingPassPlan {
  return { command: 'pnpm', args: ['--dir', queueRoot, 'proofspec', 'schedule'], detached: true }
}

/** The action that starts the pass, handed the plan it is to run. Injectable — the house
 *  `RunOptions` pattern — so a proof can observe or refuse the fire without a real pass
 *  ever being started; the failure the real action can meet (a pass that cannot even be
 *  started) is a reported finding, never a failed settle. */
export type FireSchedulingPass = (plan: SchedulingPassPlan) => void | Promise<void>

/**
 * Settles one TASK once both conditions hold, refusing as a value and touching nothing when
 * either fails. Performed in order — the state word first, because it is the fact the rest
 * of the queue keys on (a hold releases on `merged`; the pruner waits for it); then the
 * worktree and the session, which are residue — the session killed by the reaper inside
 * `teardownTask`, a short delay after this call has already answered.
 */
export async function settleTask(options: { readonly queueRoot: string; readonly task: string; readonly fireSchedulingPass?: FireSchedulingPass }): Promise<SettleResult> {
  const manifest = await manifestFor(options.queueRoot, options.task)
  if (manifest === undefined) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its queue entry has no readable MANIFEST` }
  }
  const word = await readState(options.queueRoot, options.task)
  if (word !== MERGEABLE) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its state word is ${describe(word)}, not mergeable` }
  }
  const base = baseBranch()
  const landed = await isAncestor({ cwd: options.queueRoot, ancestor: manifest.branch, descendant: base })
  if (!landed.ok) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: git could not answer whether its branch ${manifest.branch} landed in ${base} — ${landed.reason}` }
  }
  if (!landed.isAncestor) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its branch ${manifest.branch} has not landed in ${base}` }
  }
  await writeState(options.queueRoot, options.task, 'merged')
  await teardownTask(options.queueRoot, options.task)
  return { ok: true, task: options.task }
}

/** The state word as a refusal names it — a word in quotes, and a missing file named as missing. */
function describe(word: string | undefined): string {
  return word === undefined ? 'missing' : `"${word}"`
}
