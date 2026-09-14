import type { Manifest, TaskState } from './types.ts'

const MAIN = 'main'

/** One TASK with its MANIFEST already standing and its state already read. */
export type TaskRecord = {
  readonly task: string
  readonly manifest: Manifest
  readonly state: TaskState
}

/**
 * A claimed basedOn ancestry. `branch` is a claim git can check, against the named TASK's own
 * branch. `unresolved` is a claim git is never asked to check at all: the named TASK is not in
 * the queue to have a branch, so there is nothing to verify — the claim itself does not stand.
 */
export type BasedOnClaim =
  | { readonly kind: 'branch'; readonly task: string; readonly reason: string; readonly branch: string }
  | { readonly kind: 'unresolved'; readonly task: string; readonly reason: string }

/** What an in-flight TASK is measured against: its own branch, and the revision to merge-base it with. */
export type TaskBasis = {
  readonly task: string
  readonly manifest: Manifest
  readonly against: string
  readonly claim: BasedOnClaim | undefined
}

/**
 * Decides, for every in-flight TASK, which revision its edges are measured relative to. A
 * TASK based on `main` is measured against `main`; one based on another TASK is measured
 * against that TASK's own branch when it is itself in flight, and against `main` instead once
 * that TASK has merged — the work behind its name is by then already in `main`. A TASK whose
 * own state has reached merged is not read at all: it has nothing left to place on a graph of
 * what is still in flight.
 *
 * A `base` naming a TASK that is not in the queue at all is a third case neither of those is:
 * unlike a merged TASK, there is no branch behind the name for the work to already be in
 * `main`. Its own edges are still measured against `main` — the TASK's own branch is real and
 * readable — but the claim itself is carried as unresolved, so it surfaces as a problem rather
 * than silently reading as a TASK that simply has no basedOn edge.
 */
export function basesFor(tasks: readonly TaskRecord[]): readonly TaskBasis[] {
  const byName = new Map(tasks.map(one => [one.task, one]))
  return tasks.filter(one => one.state === 'in-flight').map(one => basisFor(one, byName))
}

function basisFor(task: TaskRecord, byName: ReadonlyMap<string, TaskRecord>): TaskBasis {
  if (task.manifest.base.kind === 'main') {
    return { task: task.task, manifest: task.manifest, against: MAIN, claim: undefined }
  }

  const named = task.manifest.base.task
  const reason = task.manifest.base.reason
  const target = byName.get(named)
  if (target === undefined) {
    return { task: task.task, manifest: task.manifest, against: MAIN, claim: { kind: 'unresolved', task: named, reason } }
  }
  if (target.state === 'merged') {
    return { task: task.task, manifest: task.manifest, against: MAIN, claim: undefined }
  }
  return {
    task: task.task,
    manifest: task.manifest,
    against: target.manifest.branch,
    claim: { kind: 'branch', task: named, reason, branch: target.manifest.branch },
  }
}
