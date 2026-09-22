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

/** What a settle answers its caller: it happened, or the reason it refused — never a throw. */
export type SettleResult =
  | { readonly ok: true; readonly task: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Settles one TASK once both conditions hold, refusing as a value and touching nothing when
 * either fails. Performed in order — the state word first, because it is the fact the rest
 * of the queue keys on (a hold releases on `merged`; the pruner waits for it); then the
 * worktree and the session, which are residue — the session killed by the reaper inside
 * `teardownTask`, a short delay after this call has already answered.
 */
export async function settleTask(options: { readonly queueRoot: string; readonly task: string }): Promise<SettleResult> {
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
