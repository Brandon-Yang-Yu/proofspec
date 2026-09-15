import type { TaskRecord } from '../inflight/index.ts'

/**
 * Requirement: A merged TASK's queue entry is pruned once nothing still names it
 *
 * The criterion recorded in docs/design.md §39: a merged entry stays as long as some in-flight
 * TASK's `base.task` might still name it — removing it early is what would turn a graceful
 * "based on a TASK that merged" into a false "based on a TASK the queue holds no record of at
 * all." Answerable from the same records `inflight` already reads; pruning keeps no ledger of
 * its own.
 */
export function entriesToPrune(records: readonly TaskRecord[]): readonly string[] {
  const merged = records.filter(record => record.state === 'merged').map(record => record.task)
  const stillNamed = new Set(records.flatMap(record => (record.state === 'in-flight' ? [baseTaskOf(record)] : [])).filter(isDefined))
  return merged.filter(task => !stillNamed.has(task))
}

function baseTaskOf(record: TaskRecord): string | undefined {
  return record.manifest.base.kind === 'task' ? record.manifest.base.task : undefined
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
