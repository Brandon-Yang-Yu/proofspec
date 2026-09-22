import { MERGEABLE } from './types.ts'
import type { MergeCandidate } from './types.ts'

/**
 * Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch
 * has landed in the BASE_BRANCH
 *
 * Which TASKs this pass settles: exactly the ones whose word is `mergeable` — the executor's
 * own claim the work is done — and whose branch git confirms has landed in the BASE_BRANCH.
 * Each condition covers the other's blind spot: a branch is an ancestor of the BASE_BRANCH
 * from the moment it is cut, so ancestry alone would settle a TASK before any work happened,
 * and `mergeable` alone is only a claim. Whether a branch has landed is git's question, not
 * this module's, so it arrives as a predicate the caller answers fresh from git on every
 * pass — never a cached ancestry of this rule's own.
 */
export async function tasksToMerge(
  tasks: readonly MergeCandidate[],
  landedInBase: (branch: string) => Promise<boolean>,
): Promise<readonly string[]> {
  const settled: string[] = []
  for (const task of tasks) {
    if (task.word !== MERGEABLE) continue
    if (!(await landedInBase(task.branch))) continue
    settled.push(task.task)
  }
  return settled
}
