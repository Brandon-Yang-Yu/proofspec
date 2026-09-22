#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The heartbeat CLI entry (`specs/mcp.md`): resolves `PROOFSPEC_QUEUE_ROOT` and
 * `PROOFSPEC_TASK` from the environment and performs the same heartbeat write the `pi`
 * events trigger — one write, two triggers. It writes nothing when either variable is unset,
 * and does nothing else: the hooks the Claude Code harness fires on a session's moves run
 * exactly this entry, so an unset variable must never fail a session that merely moved.
 *
 * This file is deliberately self-contained — only `node:` builtins, no sibling imports —
 * because a hook runs it as one file wherever a checkout ships it, planted alone if it must
 * be (the M4d proof plants exactly this one file into a repo that holds none of its
 * siblings); an import would break at the first checkout that carries the file without the
 * tree around it. The cost is the queue layout literal below, which mirrors `QUEUE_DIR`/
 * `HEARTBEAT_FILE` (`src/cli/queue.ts`) — the mirror is checked by the same-write scenario
 * (`tests/mcp/heartbeat.test.ts`), the one proof that would catch the two drifting apart.
 *
 * The write itself is the same one the `pi` events trigger (`refreshHeartbeat`,
 * `src/mcp/core.ts`): the instant `new Date().toISOString()` into the TASK's `heartbeat`
 * file, no `mkdir` — the heartbeat is left inside an entry that already stands — and a
 * pruned entry (`ENOENT`) is swallowed, because the heartbeat going stale is itself the
 * signal; a fault the write treats as real (permissions, disk) still surfaces through the
 * exit code.
 */
const queueRoot = process.env.PROOFSPEC_QUEUE_ROOT
const task = process.env.PROOFSPEC_TASK
if (queueRoot !== undefined && task !== undefined) {
  try {
    await writeFile(join(queueRoot, '.proofspec', 'dispatch', task, 'heartbeat'), new Date().toISOString())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
