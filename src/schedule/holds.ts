import type { TaskBasis } from '../inflight/index.ts'
import type { HoldStatus } from './types.ts'

/**
 * Requirement: A TASK held on another is released once the held-on TASK is no longer live
 *
 * Reuses `inflight`'s own basis for each TASK rather than a separate notion of liveness: a
 * basis with a `branch` claim is measured against a TASK that is still in the queue and still
 * in flight, which is exactly what "held" means. A basis with no claim, or an unresolved one,
 * is what `inflight` already answers for a base naming a merged TASK or one gone from the
 * queue entirely — both mean the named TASK is no longer live, so the hold is released.
 */
export function holdStatusFor(bases: readonly TaskBasis[]): readonly HoldStatus[] {
  return bases.filter(basis => basis.manifest.base.kind === 'task').map(holdFor)
}

function holdFor(basis: TaskBasis): HoldStatus {
  if (basis.claim?.kind === 'branch') return { kind: 'held', task: basis.task, on: basis.claim.task }
  return { kind: 'released', task: basis.task }
}
