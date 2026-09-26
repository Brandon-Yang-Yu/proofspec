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
 * says `blocked-on-question` the question it points at must already stand. A pruned entry
 * (`ENOENT`) is swallowed, as the heartbeat entry swallows it: a TASK the queue no longer
 * holds has no one left to park it for. A fault the write treats as real (permissions, disk)
 * still surfaces through the exit code.
 */

/** The fields of the `StopFailure` payload that can carry the provider's error, best first:
 *  `error_details` holds it exactly; the last assistant text quotes it behind a harness
 *  prefix; `error` is only a category. A later field is read only when every earlier one is
 *  absent, so a TASK never parks with an empty QUESTION while the hook handed any error text. */
const ERROR_FIELDS = ['error_details', 'last_assistant_message', 'error'] as const

/** What QUESTION says when the hook handed no error text at all. */
const NO_ERROR_TEXT = 'The provider stopped this session, and its StopFailure hook handed no error text.'

const queueRoot = process.env.PROOFSPEC_QUEUE_ROOT
const task = process.env.PROOFSPEC_TASK
if (queueRoot !== undefined && task !== undefined) {
  const entry = join(queueRoot, '.proofspec', 'dispatch', task)
  const question = questionFrom(parseJson(await readStdin()))
  try {
    await writeFile(join(entry, 'QUESTION'), question)
    await writeFile(join(entry, 'state'), 'blocked-on-question')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

type ParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }

async function readStdin(): Promise<string> {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

/** `JSON.parse` at the boundary, its throw turned into a value: the harness owns the payload,
 *  so an empty or malformed one is an expected failure, not a bug in this entry. */
function parseJson(input: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(input) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** The QUESTION a parked TASK carries: the first error field the payload holds as a string,
 *  verbatim — else a line saying the hook handed no readable error, so the QUESTION still
 *  tells a human why the TASK stopped. */
function questionFrom(parsed: ParseResult): string {
  if (!parsed.ok) return `${NO_ERROR_TEXT} Its payload could not be read: ${parsed.reason}`
  const payload = parsed.value
  if (typeof payload !== 'object' || payload === null) return NO_ERROR_TEXT
  for (const field of ERROR_FIELDS) {
    const text: unknown = Reflect.get(payload, field)
    if (typeof text === 'string') return text
  }
  return NO_ERROR_TEXT
}
