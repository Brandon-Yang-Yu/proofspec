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
 * because it is run from wherever a checkout ships it, planted by hand if it must be, the
 * same way the hooks name it by its own path. The write itself is the same one
 * `refreshHeartbeat` (`src/mcp/core.ts`) performs for the `pi` events: the instant
 * `new Date().toISOString()` written into the TASK's `heartbeat` file, no `mkdir` (the
 * heartbeat is left inside an entry that already stands), and a pruned entry (`ENOENT`) is
 * swallowed — the heartbeat going stale is itself the signal, and a fault the write treats
 * as real (permissions, disk) still surfaces through the exit code.
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
