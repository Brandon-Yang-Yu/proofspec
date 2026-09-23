import type { TaskRecord } from '../inflight/index.ts'

/**
 * Requirement: A merged TASK's queue entry is pruned once nothing still names it
 *
 * The reason behind the requirement above: a merged entry stays as long as some in-flight
 * TASK's `blocked.task` might still name it — removing it early is what would turn a
 * graceful "blocked on a TASK that merged" into a false "blocked on a TASK the queue holds
 * no record of at all." Answerable from the same records `inflight` already reads; pruning
 * keeps no ledger of its own.
 */
export function entriesToPrune(records: readonly TaskRecord[]): readonly string[] {
  const merged = records.filter(record => record.state === 'merged').map(record => record.task)
  const stillNamed = new Set(
    records.flatMap(record => (record.state === 'in-flight' ? [record.manifest.blocked?.task] : [])).filter(isDefined),
  )
  return merged.filter(task => !stillNamed.has(task))
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
