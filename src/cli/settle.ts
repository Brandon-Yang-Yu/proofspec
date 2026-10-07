import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/** The one scheduling pass a successful settle fires against the queue root: this very
 *  build's own CLI entry run by node itself (`process.execPath`) — never through the package
 *  manager, because a repo that installed proofspec has no script named `proofspec`, and a
 *  pass routed through one dies there. Carried as a pure plan value the way the reaper's is
 *  (`reaperFor`/`ReaperPlan`, `src/cli/session.ts`), so a proof can observe which pass a
 *  settle fires, and how it is started, without ever starting it. */
export type SchedulingPassPlan = {
  /** The node binary running this very settle (`process.execPath`), so the pass is the same
   *  proofspec build as the settle that fired it. */
  readonly command: string
  /** Node's own flags, the CLI entry they run, and the one argument `schedule`. */
  readonly args: readonly string[]
  /** The pass's working folder: the queue root itself — never the settle's own current
   *  folder, which its teardown removes right after the pass starts. */
  readonly cwd: string
  /** The TASK whose settle fired the pass — the one fact the settle-pass log's header line
   *  names (`realFireSchedulingPass`, `src/mcp/core.ts`). */
  readonly task: string
  /** The process-group escape: the pass is started detached, in a process group of its
   *  own, so the delayed reaper's group-kill — the one that takes the settle's own session
   *  — cannot reach it. The escape is the point, not spawn syntax. */
  readonly detached: true
}

/** The CLI entry of the very build running this settle, as node runs it: `main.ts` beside
 *  this module when proofspec runs from its own source (the repo's `pnpm proofspec` script),
 *  `main.js` beside it when it runs from the built package (what a consumer's node_modules
 *  holds). Resolved against the running module itself — not the working folder, not the
 *  queue root — so wherever the settle was reached from, the pass it fires is the same
 *  build. The source entry carries the transform flag the repo's own script carries, so a
 *  from-source pass starts exactly the way that script starts it. */
function cliEntryFor(): { readonly path: string; readonly nodeFlags: readonly string[] } {
  const fromSource = fileURLToPath(new URL('./main.ts', import.meta.url))
  if (existsSync(fromSource)) return { path: fromSource, nodeFlags: ['--experimental-transform-types'] }
  return { path: fileURLToPath(new URL('./main.js', import.meta.url)), nodeFlags: [] }
}

/** The pass a settle fires for `queueRoot`: node running this build's own CLI entry with the
 *  one argument `schedule`, the queue root as the pass's working folder, detached so the
 *  pass survives the settle's teardown. */
export function schedulingPassFor(options: { readonly queueRoot: string; readonly task: string }): SchedulingPassPlan {
  const entry = cliEntryFor()
  return {
    command: process.execPath,
    args: [...entry.nodeFlags, entry.path, 'schedule'],
    cwd: options.queueRoot,
    task: options.task,
    detached: true,
  }
}

/** The action that starts the pass, handed the plan it is to run. Injectable — the house
 *  `RunOptions` pattern — so a proof can observe or refuse the fire without a real pass
 *  ever being started; a fire that fails can never fail the settle (see
 *  `fireTheSchedulingPass`). */
export type FireSchedulingPass = (plan: SchedulingPassPlan) => void | Promise<void>

/**
 * Settles one TASK once both conditions hold, refusing as a value and touching nothing when
 * either fails. Performed in order — the state word first, because it is the fact the rest
 * of the queue keys on (a hold releases on `merged`; the pruner waits for it); then the one
 * scheduling pass a successful settle fires, before anything is torn down so the pass finds
 * the queue exactly as the landing left it; then the worktree and the session, which are
 * residue — the session killed by the reaper inside `teardownTask`, a short delay after this
 * call has already answered.
 */
export async function settleTask(options: {
  readonly queueRoot: string
  readonly task: string
  /** The BASE_BRANCH's name, as the settings file each caller reads gives it. */
  readonly baseBranch: string
  readonly fireSchedulingPass?: FireSchedulingPass
}): Promise<SettleResult> {
  const manifest = await manifestFor(options.queueRoot, options.task)
  if (manifest === undefined) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its queue entry has no readable MANIFEST` }
  }
  const word = await readState(options.queueRoot, options.task)
  if (word !== MERGEABLE) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its state word is ${describe(word)}, not mergeable` }
  }
  const base = options.baseBranch
  const landed = await isAncestor({ cwd: options.queueRoot, ancestor: manifest.branch, descendant: base })
  if (!landed.ok) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: git could not answer whether its branch ${manifest.branch} landed in ${base} — ${landed.reason}` }
  }
  if (!landed.isAncestor) {
    return { ok: false, reason: `TASK ${options.task} cannot be settled: its branch ${manifest.branch} has not landed in ${base}` }
  }
  await writeState(options.queueRoot, options.task, 'merged')
  await fireTheSchedulingPass(options)
  await teardownTask(options.queueRoot, options.task)
  return { ok: true, task: options.task }
}

/** Fires the settle's one scheduling pass, swallowing a failure to start it — sync or async.
 *  The fire is best-effort by contract (a later pass repairs the queue): the landing is
 *  already settled, a pass that cannot even be started must not un-settle it, and nothing
 *  proven asks the settle's answer to report one. With no action given, nothing fires — the
 *  shared settle also serves the pass's own backstop caller, and a pass firing a pass from
 *  inside a pass serves nothing. Named for the act, distinct from the injected action it
 *  reads. */
async function fireTheSchedulingPass(options: { readonly queueRoot: string; readonly task: string; readonly fireSchedulingPass?: FireSchedulingPass }): Promise<void> {
  if (options.fireSchedulingPass === undefined) return
  try {
    await options.fireSchedulingPass(schedulingPassFor(options))
  } catch {
    // Swallowed on purpose: the landing is already settled, and a fire that could not start
    // its pass is repaired by whatever fires the next pass — never by failing this settle.
  }
}

/** The state word as a refusal names it — a word in quotes, and a missing file named as missing. */
function describe(word: string | undefined): string {
  return word === undefined ? 'missing' : `"${word}"`
}
