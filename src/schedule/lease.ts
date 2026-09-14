import { BUILDING } from './types.ts'
import type { LeaseDecision, LeaseRecord, ScheduleTask } from './types.ts'

/** How long a LEASE stands before it is reclaimable, absent the TASK's state advancing to `building`. */
export const LEASE_GRACE_MS = 2 * 60 * 1000

/**
 * Requirements: Dispatching a ready TASK starts exactly one work-agent session /
 * A stale LEASE is told apart from a live one by elapsed time, not by probing a process
 *
 * No LEASE at all is the ordinary case a ready TASK starts in: take it. A LEASE already taken
 * blocks a second session for as long as the grace period has not elapsed — the ordinary case
 * of two scheduling passes finding the same ready TASK, not a rare race. Once the state has
 * actually advanced to `building`, the session is live and stays blocked regardless of how much
 * time has passed; short of that, elapsed time past the grace period is what tells a stale LEASE
 * (the claimant crashed, or never started) apart from a live one — never a check on whether a
 * process is still running.
 */
export function leaseDecision(input: {
  readonly existing: LeaseRecord | undefined
  readonly word: string
  readonly now: Date
  readonly graceMs?: number
}): LeaseDecision {
  if (input.existing === undefined) return { kind: 'take' }
  if (input.word === BUILDING) return { kind: 'blocked' }
  const elapsed = input.now.getTime() - new Date(input.existing.takenAt).getTime()
  const grace = input.graceMs ?? LEASE_GRACE_MS
  return elapsed < grace ? { kind: 'blocked' } : { kind: 'take' }
}

const QUEUED = 'queued'

/** Which TASKs are ready to dispatch: queued, and not held on another TASK still live. */
export function readyToDispatch(tasks: readonly ScheduleTask[], held: ReadonlySet<string>): readonly string[] {
  return tasks.filter(task => task.word === QUEUED && !held.has(task.task)).map(task => task.task)
}
