import { baseBranch } from '../base-branch.ts'
import type { Manifest, TaskState } from './types.ts'

/** One TASK with its MANIFEST already standing and its state already read. */
export type TaskRecord = {
  readonly task: string
  readonly manifest: Manifest
  readonly state: TaskState
}

/** What an in-flight TASK is measured against: its own branch, and the revision to merge-base it with. */
export type TaskBasis = {
  readonly task: string
  readonly manifest: Manifest
  readonly against: string
}

/**
 * Decides, for every in-flight TASK, which revision its edges are measured relative to: the
 * BASE_BRANCH, always. A blocked TASK's branch is cut from the BASE_BRANCH like any other —
 * the hold decides when the TASK may start, not where its branch begins — so the merge-base
 * with the BASE_BRANCH is where every TASK's own history begins alike. A TASK whose own
 * state has reached merged is not read at all: it has nothing left to place on a graph of
 * what is still in flight.
 *
 * A `blocked` naming a TASK the queue does not hold changes none of that: the TASK's own
 * branch is real and readable, so it is measured like any other, and the dangling name
 * surfaces as that TASK's problem when the graph is drawn.
 */
export function basesFor(tasks: readonly TaskRecord[]): readonly TaskBasis[] {
  return tasks
    .filter(one => one.state === 'in-flight')
    .map(one => ({ task: one.task, manifest: one.manifest, against: baseBranch() }))
}
