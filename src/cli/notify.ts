import type { Relationship } from '../inflight/index.ts'
import { relationshipKey } from '../schedule/index.ts'
import type { ScheduleActions } from '../schedule/index.ts'

/**
 * The real `notifyHuman` action `startSession`/`judge` already have a twin of: it writes the
 * finding to stderr, never stdout, since stdout is reserved for the one machine-readable
 * answer `main.ts` prints. Includes the relationship's key so a human can answer it directly
 * with `schedule --ruling`. Paging or proactively alerting a human who is not currently
 * watching is deliberately out of scope here — this only reaches whoever is already watching
 * the process that ran the scheduling pass.
 */
export function stderrNotifyHuman(): NonNullable<ScheduleActions['notifyHuman']> {
  return async relationship => {
    process.stderr.write(messageFor(relationship))
  }
}

function messageFor(relationship: Relationship): string {
  const key = relationshipKey(relationship)
  const tasks = [...relationship.tasks].join(', ')
  return (
    `schedule: an unresolved relationship needs a human — ${relationship.node.kind} "${relationship.node.name}" shared by ${tasks}\n` +
    `  answer with: proofspec schedule --ruling "<your ruling>" '${key}'\n`
  )
}
