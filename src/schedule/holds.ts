import type { TaskRecord } from '../inflight/index.ts'
import type { HoldStatus } from './types.ts'

/**
 * Requirement: A TASK held on another is released once the held-on TASK is no longer live
 *
 * Reads the `blocked` field straight from each record: a TASK is held while the TASK it names
 * is on the queue and still in flight, and released once that TASK has merged or left the
 * queue — either way, the work it waits behind has either landed or never stood. A TASK
 * carrying no `blocked` carries no hold status at all: it waits on nothing.
 */
export function holdStatusFor(records: readonly TaskRecord[]): readonly HoldStatus[] {
  const byName = new Map(records.map(one => [one.task, one]))
  const statuses: HoldStatus[] = []
  for (const record of records) {
    if (record.state !== 'in-flight') continue
    const blocked = record.manifest.blocked
    if (blocked === undefined) continue
    const named = byName.get(blocked.task)
    statuses.push(
      named !== undefined && named.state === 'in-flight'
        ? { kind: 'held', task: record.task, on: blocked.task }
        : { kind: 'released', task: record.task },
    )
  }
  return statuses
}
