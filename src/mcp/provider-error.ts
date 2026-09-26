#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The provider-error CLI entry (`specs/mcp.md`): the Claude Code `StopFailure` hook runs it
 * when a dispatched session's turn ends on a provider error, and it parks the TASK for a
 * human — the provider's error into the queue entry's `QUESTION`, then the state word
 * `blocked-on-question` — so the TASK shows on the docket as waiting rather than hanging.
 * It resolves `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK` from the environment and writes
 * nothing when either is unset: a hook must never fail, or guess at, a session the queue
 * did not start.
 *
 * Self-contained — only `node:` builtins, no sibling imports — for the reason the heartbeat
 * entry (`src/mcp/heartbeat.ts`) is: a hook runs it as one file wherever a checkout ships it.
 * The queue layout literal below mirrors `QUEUE_DIR` and the entry's file names
 * (`src/cli/queue.ts`); the provider-error proofs (`tests/mcp/provider-error.test.ts`) would
 * catch the two drifting apart.
 *
 * `QUESTION` is written before the state word: the word is what a reader keys on, so once it
 * says `blocked-on-question` the question it points at must already stand.
 */
const queueRoot = process.env.PROOFSPEC_QUEUE_ROOT
const task = process.env.PROOFSPEC_TASK
if (queueRoot !== undefined && task !== undefined) {
  const entry = join(queueRoot, '.proofspec', 'dispatch', task)
  await writeFile(join(entry, 'QUESTION'), await providerErrorFromStdin())
  await writeFile(join(entry, 'state'), 'blocked-on-question')
}

/** The provider's own error out of the `StopFailure` payload on stdin: `error_details`,
 *  exactly as the harness hands it — the `error` field is only a category, and the last
 *  assistant text quotes the error behind a harness prefix. */
async function providerErrorFromStdin(): Promise<string> {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input) as { readonly error_details?: unknown }
  return typeof payload.error_details === 'string' ? payload.error_details : ''
}
