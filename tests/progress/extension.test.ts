// Capability: progress

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import progressExtension, { executeReportTaskState, runReportTaskState } from '../../src/progress/extension.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// Unconditional, not a manual delete at the end of the test body it belongs to — the same
// leaked-ambient-state guard `tests/schedule/session.test.ts` already keeps for its own env
// overrides.
afterEach(() => {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
})

/** Writes one task subdirectory under the conventional queue path, the same shape
 *  `tests/schedule/queue.test.ts` writes fixtures with. */
async function writeTask(
  root: string,
  task: string,
  files: { readonly manifest?: string; readonly state?: string; readonly lease?: string },
): Promise<void> {
  const dir = join(root, '.proofspec', 'dispatch', task)
  await mkdir(dir, { recursive: true })
  if (files.manifest !== undefined) await writeFile(join(dir, 'MANIFEST'), files.manifest)
  if (files.state !== undefined) await writeFile(join(dir, 'state'), files.state)
  if (files.lease !== undefined) await writeFile(join(dir, 'LEASE'), files.lease)
}

async function stateOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'state'), 'utf8')
}

async function manifestOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'MANIFEST'), 'utf8')
}

async function leaseOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'LEASE'), 'utf8')
}

// Requirement: report_task_state accepts only a closed set of state words
// Scenario: A state word outside the reportable set is refused, naming the word, and the entry's state is unchanged
// GIVEN a queue entry whose state is queued
// WHEN report_task_state is called with a word outside the reportable set
// THEN it refuses, naming the given word, and the entry's state is unchanged
it('refuses a state word outside the reportable set, leaving the entry unchanged', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })

  const result = await runReportTaskState({ queueRoot: repo.root, task: 'a' }, 'queued')

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('queued') })
  expect(await stateOf(repo.root, 'a')).toBe('queued')
})

// Requirement: report_task_state resolves PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK from the environment, refused when absent
// Scenario: The registered tool reports into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory
// GIVEN PROOFSPEC_QUEUE_ROOT/PROOFSPEC_TASK set to a real queue entry, and an ExtensionContext whose cwd names an unrelated directory
// WHEN the registered tool's execute runs
// THEN the state is written under PROOFSPEC_QUEUE_ROOT, not under ExtensionContext.cwd
it('reports into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory', async () => {
  const queueRoot = await makeRepo({})
  const unrelatedCwd = await makeRepo({})
  await writeTask(queueRoot.root, 'a', { manifest: '{}', state: 'queued' })
  process.env.PROOFSPEC_QUEUE_ROOT = queueRoot.root
  process.env.PROOFSPEC_TASK = 'a'
  const fakeContext = { cwd: unrelatedCwd.root } as unknown as ExtensionContext

  const result = await executeReportTaskState('call-1', { state: 'building' }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: true, task: 'a', state: 'building' })
  expect(await stateOf(queueRoot.root, 'a')).toBe('building')
  await expect(stateOf(unrelatedCwd.root, 'a')).rejects.toThrow()
})

// Requirement: report_task_state accepts only a closed set of state words
// Scenario: blocked-on-question is accepted as a reportable state
// GIVEN a queue entry whose state is queued
// WHEN report_task_state is called with blocked-on-question
// THEN it succeeds and the entry's state becomes blocked-on-question
it('accepts blocked-on-question as a reportable state', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })

  const result = await runReportTaskState({ queueRoot: repo.root, task: 'a' }, 'blocked-on-question')

  expect(result).toEqual({ ok: true, task: 'a', state: 'blocked-on-question' })
  expect(await stateOf(repo.root, 'a')).toBe('blocked-on-question')
})

// Requirement: report_task_state resolves PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK from the environment, refused when absent
// Scenario: A report with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry, and no PROOFSPEC_QUEUE_ROOT set in the environment
// WHEN the registered tool's execute runs
// THEN it refuses, naming PROOFSPEC_QUEUE_ROOT, and the entry's state is left unchanged
// `resolveReportEnv` alone has no filesystem access, so proving "nothing is written" needs the
// real boundary (`executeReportTaskState`) against a real queue entry — a pure resolver test
// could only ever prove the refusal's wording, never the write it claims never happens.
it('refuses to report when PROOFSPEC_QUEUE_ROOT is not set, writing nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })
  delete process.env.PROOFSPEC_QUEUE_ROOT
  process.env.PROOFSPEC_TASK = 'a'
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeReportTaskState('call-1', { state: 'building' }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_QUEUE_ROOT') })
  expect(await stateOf(repo.root, 'a')).toBe('queued')
})

// Requirement: report_task_state resolves PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK from the environment, refused when absent
// Scenario: A report with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry, and no PROOFSPEC_TASK set in the environment
// WHEN the registered tool's execute runs
// THEN it refuses, naming PROOFSPEC_TASK, and the entry's state is left unchanged
it('refuses to report when PROOFSPEC_TASK is not set, writing nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  delete process.env.PROOFSPEC_TASK
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeReportTaskState('call-1', { state: 'building' }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_TASK') })
  expect(await stateOf(repo.root, 'a')).toBe('queued')
})

// Requirement: report_task_state delegates to writeState and answers its outcome as a value
// Scenario: A reported state is written to the queue entry at the given queueRoot
// GIVEN a queue entry under a queueRoot
// WHEN building is reported
// THEN that entry's state file reads building
// The "never under ExtensionContext.cwd" half of this claim belongs to the registered tool's
// execute wiring, not this pure function — runReportTaskState takes queueRoot as an explicit
// parameter and has no cwd to fall back to at all; that boundary is proven by "reports into
// PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory" above,
// where a constructed ExtensionContext genuinely could be, but isn't, used.
it('writes a reported state to the queue entry at the given queueRoot', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })

  const result = await runReportTaskState({ queueRoot: repo.root, task: 'a' }, 'building')

  expect(result).toEqual({ ok: true, task: 'a', state: 'building' })
  expect(await stateOf(repo.root, 'a')).toBe('building')
})

// Requirement: report_task_state delegates to writeState and answers its outcome as a value
// Scenario: Reporting a state leaves the entry's MANIFEST and LEASE exactly as they were
// GIVEN a queue entry carrying a MANIFEST and a LEASE
// WHEN a state is reported
// THEN both the MANIFEST and the LEASE are left exactly as they were
it('leaves the entry\'s MANIFEST and LEASE untouched when a state is reported', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{"branch":"work/a"}', state: 'queued', lease: '2026-01-01T00:00:00.000Z' })

  await runReportTaskState({ queueRoot: repo.root, task: 'a' }, 'mergeable')

  expect(await manifestOf(repo.root, 'a')).toBe('{"branch":"work/a"}')
  expect(await leaseOf(repo.root, 'a')).toBe('2026-01-01T00:00:00.000Z')
})

// Requirement: report_task_state delegates to writeState and answers its outcome as a value
// Scenario: Reporting a state for a TASK whose queue entry has been pruned is refused as a value, never thrown
// GIVEN a TASK name with no queue entry at all
// WHEN a state is reported for it
// THEN it refuses as a value naming the TASK, rather than throwing
it('refuses as a value, never throwing, when the TASK has no queue entry', async () => {
  const repo = await makeRepo({})

  const result = await runReportTaskState({ queueRoot: repo.root, task: 'never-queued' }, 'building')

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('never-queued') })
})

// --- the heartbeat limb ---------------------------------------------------------

/** The six pi events the heartbeat contract counts as observable moves: a turn starting or
 *  ending, a tool call starting, updating, or ending, and each streamed part of a reply. */
const OBSERVABLE_MOVES = [
  'turn_start',
  'turn_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'message_update',
] as const

/** A handler the extension subscribed, with the per-event payloads this contract ignores
 *  stripped away — one shape so one Map can hold all six. */
type CapturedHandler = (event: never, ctx: ExtensionContext) => unknown

/** Registers the extension against a fake `ExtensionAPI` that records every `on(event,
 *  handler)` subscription for the test to fire itself. `registerTool` is accepted and
 *  ignored — the tool is the other limb's concern. */
function registerExtension(): ReadonlyMap<string, CapturedHandler> {
  const handlers = new Map<string, CapturedHandler>()
  const pi = {
    on: (event: string, handler: CapturedHandler): void => {
      handlers.set(event, handler)
    },
    registerTool: (): void => {},
  }
  progressExtension(pi as unknown as ExtensionAPI)
  return handlers
}

/** Fires the handler subscribed to `event`. The heartbeat contract ignores the event's own
 *  payload, so empty stand-ins stand in for it; a missing subscription is itself the
 *  failure — thrown with the event named so the red run says what never arrived. */
async function fireEvent(handlers: ReadonlyMap<string, CapturedHandler>, event: string): Promise<void> {
  const handler = handlers.get(event)
  if (handler === undefined) throw new Error(`the extension subscribed no handler to ${event}`)
  await handler({} as never, {} as unknown as ExtensionContext)
}

function heartbeatPath(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task, 'heartbeat')
}

/** Reads the TASK's heartbeat, or `undefined` while none exists — one shape that backs both
 *  "it appeared" and "it never appeared" without absence having to throw. */
async function readHeartbeat(root: string, task: string): Promise<string | undefined> {
  try {
    return await readFile(heartbeatPath(root, task), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

// Requirement: The extension refreshes a heartbeat on every move the session makes
// Scenario: A heartbeat file is refreshed in the TASK's queue entry on every observable move the session makes
// GIVEN a real queue entry named by PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK
// WHEN each of the six observable-move events fires, with the heartbeat deleted before each one
// THEN after each event the entry holds a heartbeat whose content parses as a timestamp
// Deleting the heartbeat between fires is what proves each event writes on its own — no
// ordering between events, no timing to race.
it('refreshes a heartbeat in the TASK\'s queue entry on every observable move', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const handlers = registerExtension()

  for (const event of OBSERVABLE_MOVES) {
    await rm(heartbeatPath(repo.root, 'a'), { force: true })
    await fireEvent(handlers, event)

    const heartbeat = await readHeartbeat(repo.root, 'a')
    expect(heartbeat, `no heartbeat was refreshed after ${event}`).toBeDefined()
    expect(
      heartbeat !== undefined && !Number.isNaN(Date.parse(heartbeat)),
      `the heartbeat refreshed by ${event} is not a timestamp`,
    ).toBe(true)
  }
})

// Requirement: The extension refreshes a heartbeat on every move the session makes
// Scenario: No heartbeat is written when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset
// GIVEN a real queue entry, and first PROOFSPEC_QUEUE_ROOT then PROOFSPEC_TASK unset in the environment
// WHEN an observable-move event fires after each unset
// THEN no heartbeat file ever appears in the entry
it('writes no heartbeat when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const handlers = registerExtension()

  delete process.env.PROOFSPEC_QUEUE_ROOT
  await fireEvent(handlers, 'turn_start')
  expect(await readHeartbeat(repo.root, 'a')).toBeUndefined()

  // Restoring QUEUE_ROOT keeps the second fire about TASK's absence alone, not both at once.
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  delete process.env.PROOFSPEC_TASK
  await fireEvent(handlers, 'turn_start')
  expect(await readHeartbeat(repo.root, 'a')).toBeUndefined()
})

// Requirement: The extension refreshes a heartbeat on every move the session makes
// Scenario: A heartbeat refresh leaves the entry's state, MANIFEST, and LEASE exactly as they were
// GIVEN a queue entry carrying a state, a MANIFEST, and a LEASE
// WHEN all six observable-move events fire
// THEN the state, the MANIFEST, and the LEASE read back byte-for-byte as written
it('leaves the entry\'s state, MANIFEST, and LEASE untouched by heartbeat refreshes', async () => {
  const repo = await makeRepo({})
  const manifest = '{"branch":"work/a"}'
  const state = 'building'
  const lease = '2026-01-01T00:00:00.000Z'
  await writeTask(repo.root, 'a', { manifest, state, lease })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const handlers = registerExtension()

  for (const event of OBSERVABLE_MOVES) {
    await fireEvent(handlers, event)
  }

  expect(await manifestOf(repo.root, 'a')).toBe(manifest)
  expect(await stateOf(repo.root, 'a')).toBe(state)
  expect(await leaseOf(repo.root, 'a')).toBe(lease)
})
