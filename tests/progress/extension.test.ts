// Capability: progress

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import progressExtension, { executeReportTaskPhase, executeReportTaskState, runReportTaskPhase, runReportTaskState } from '../../src/progress/extension.ts'
import { appendPhaseHistory, readPhase, readPhaseHistory, writePhase } from '../../src/cli/queue.ts'
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

async function heartbeatOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'heartbeat'), 'utf8')
}

/** The path of a TASK's phase file — the one file whose bytes a report may rewrite. */
function phasePath(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task, 'phase')
}

/** The raw bytes of a TASK's phase file, or undefined while none stands — byte identity, not
 *  parsed equality, is what proves a report that changes nothing wrote nothing at all. */
async function phaseFileBytes(root: string, task: string): Promise<string | undefined> {
  try {
    return await readFile(phasePath(root, task), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** The path of a TASK's phase-history file — the file a report appends standings to. */
function phaseHistoryPath(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task, 'phase-history')
}

/** The raw bytes of a TASK's phase-history file, or undefined while none stands — the same
 *  byte-identity standard the phase file keeps. */
async function phaseHistoryFileBytes(root: string, task: string): Promise<string | undefined> {
  try {
    return await readFile(phaseHistoryPath(root, task), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** The moment a path was last written, or undefined while nothing stands there — a rewrite
 *  of identical bytes is still a write, and the write time is the one observable it cannot
 *  fake. */
async function writtenAt(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

// --- the pace-word limb ---------------------------------------------------------------

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase word and its round are written into the TASK's phase file, answered as a value
// GIVEN a real queue entry
// WHEN report_task_phase runs with phase test-review and round 2
// THEN the entry's phase file holds exactly that word and round, and the answer is {ok, task, phase, round}
it('writes the phase word and round into the TASK\'s phase file, answered as a value', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'test-review', 2)

  expect(result).toEqual({ ok: true, task: 'a', phase: 'test-review', round: 2 })
  expect(await readPhase(repo.root, 'a')).toEqual({ phase: 'test-review', round: 2, since: expect.any(Number) })
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase report with no round given defaults the round to 1
// GIVEN a real queue entry
// WHEN report_task_phase runs with a phase word and no round
// THEN the round is 1 — answered and written alike, the first pass through any step
it('defaults the round to 1 when the report gives none', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'explorer')

  expect(result).toEqual({ ok: true, task: 'a', phase: 'explorer', round: 1 })
  expect(await readPhase(repo.root, 'a')).toEqual({ phase: 'explorer', round: 1, since: expect.any(Number) })
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase report trims the word it is given
// GIVEN a real queue entry
// WHEN report_task_phase runs with a word carrying surrounding whitespace
// THEN the word written and answered is the trimmed one — the pace word is a word, not a spacing accident
it('trims the phase word it is given', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, '  ui-design  ')

  expect(result).toEqual({ ok: true, task: 'a', phase: 'ui-design', round: 1 })
  expect(await readPhase(repo.root, 'a')).toEqual({ phase: 'ui-design', round: 1, since: expect.any(Number) })
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase word that is empty or only whitespace is refused, naming why, touching nothing
// GIVEN a real queue entry holding no phase file
// WHEN report_task_phase runs with the empty word, then with only whitespace
// THEN each call refuses, naming the word as the problem, and no phase file ever appears
it('refuses an empty or whitespace-only phase word, touching nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  for (const word of ['', '   ']) {
    const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, word)
    expect(result, `the empty-word report for ${JSON.stringify(word)}`).toEqual({ ok: false, reason: expect.stringContaining('phase') })
  }
  expect(await readPhase(repo.root, 'a')).toBeUndefined()
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A round below 1, or one that is not an integer, is refused, naming why
// GIVEN a real queue entry holding no phase file
// WHEN report_task_phase runs with round 0, then with round 2.5
// THEN each call refuses, naming the round as the problem, and no phase file ever appears
it('refuses a round below 1 or not an integer, touching nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  for (const round of [0, 2.5]) {
    const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'test-review', round)
    expect(result, `the out-of-range round ${round}`).toEqual({ ok: false, reason: expect.stringContaining('round') })
  }
  expect(await readPhase(repo.root, 'a')).toBeUndefined()
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase report leaves the entry's state, MANIFEST, LEASE, and heartbeat exactly as they were
// GIVEN a queue entry carrying a state, a MANIFEST, a LEASE, and a heartbeat
// WHEN a phase is reported three times over — a word the entry has never held, a new round under that word, then the same word and round again
// THEN all four read back byte-for-byte as written — every write case the report takes touches nothing but its own files
it('leaves the entry\'s state, MANIFEST, LEASE, and heartbeat untouched by a phase report', async () => {
  const repo = await makeRepo({})
  const manifest = '{"branch":"work/a"}'
  const state = 'building'
  const lease = '2026-01-01T00:00:00.000Z'
  await writeTask(repo.root, 'a', { manifest, state, lease })
  await writeFile(join(repo.root, '.proofspec', 'dispatch', 'a', 'heartbeat'), '2026-01-01T00:00:05.000Z')

  // All three write cases in one entry — a word change, a round change, and the no-op —
  // because the prose states the touch-nothing-else rule unconditionally, not per case.
  await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'tests-red', 1)
  await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'tests-red', 2)
  await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'tests-red', 2)

  expect(await manifestOf(repo.root, 'a')).toBe(manifest)
  expect(await stateOf(repo.root, 'a')).toBe(state)
  expect(await leaseOf(repo.root, 'a')).toBe(lease)
  expect(await heartbeatOf(repo.root, 'a')).toBe('2026-01-01T00:00:05.000Z')
})

// The conditional write — what a report writes given what the entry already holds. The
// fixtures below pin `since` to fixed past moments (far from any clock this run could read)
// so a since that survives, and a since that moves, are told apart by value, not by timing.

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A first report records the standing and opens the history
// GIVEN a real queue entry holding no phase file and no phase-history file
// WHEN report_task_phase runs with phase build-green and round 1
// THEN the phase file records that word, that round, and a since inside the call's own instants, the history holds exactly that one standing, and the answer is {ok, task, phase, round}
it('records the standing and opens the history on a first report', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  const t0 = Date.now()
  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'build-green', 1)
  const t1 = Date.now()

  expect(result).toEqual({ ok: true, task: 'a', phase: 'build-green', round: 1 })
  const standing = await readPhase(repo.root, 'a')
  expect(standing).toEqual({ phase: 'build-green', round: 1, since: expect.any(Number) })
  const since = standing?.since ?? Number.NaN
  expect(since).toBeGreaterThanOrEqual(t0)
  expect(since).toBeLessThanOrEqual(t1)
  expect(await readPhaseHistory(repo.root, 'a')).toEqual([{ phase: 'build-green', round: 1, since }])
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A report whose word and round both match the standing writes nothing at all
// GIVEN a queue entry whose phase file already records build-green round 2 since a fixed past moment, and whose phase-history already holds one standing
// WHEN report_task_phase runs with the same word build-green and the same round 2
// THEN the phase file's bytes and write time stand unchanged, the history's bytes and write time stand unchanged, and the answer is still ok — a report that changed nothing is a success, not a refusal
it('writes nothing at all when the report matches the standing word and round', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  await writePhase(repo.root, 'a', { phase: 'build-green', round: 2, since: 1_700_000_000_000 })
  await appendPhaseHistory(repo.root, 'a', { phase: 'tests-red', round: 1, since: 1_699_999_000_000 })
  const bytesBefore = await phaseFileBytes(repo.root, 'a')
  const historyBefore = await phaseHistoryFileBytes(repo.root, 'a')
  const phaseWrittenAt = await writtenAt(phasePath(repo.root, 'a'))
  const historyWrittenAt = await writtenAt(phaseHistoryPath(repo.root, 'a'))

  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'build-green', 2)

  expect(result).toEqual({ ok: true, task: 'a', phase: 'build-green', round: 2 })
  expect(await phaseFileBytes(repo.root, 'a')).toBe(bytesBefore)
  expect(await phaseHistoryFileBytes(repo.root, 'a')).toBe(historyBefore)
  // The write times too: a rewrite of identical bytes is still a write, and the prose
  // promises no write at all.
  expect(await writtenAt(phasePath(repo.root, 'a'))).toBe(phaseWrittenAt)
  expect(await writtenAt(phaseHistoryPath(repo.root, 'a'))).toBe(historyWrittenAt)
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A round change rewrites the round and keeps the since the file records
// GIVEN a queue entry whose phase file records test-review round 1 since a fixed past moment
// WHEN report_task_phase runs with the same word test-review and round 2
// THEN the phase file holds round 2 with the since exactly as it stood, and the history gains one entry — that word, that round, since the report's own now
it('keeps the standing since while rewriting the round on a round change', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  const standingSince = 1_700_000_000_000
  await writePhase(repo.root, 'a', { phase: 'test-review', round: 1, since: standingSince })

  const t0 = Date.now()
  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'test-review', 2)
  const t1 = Date.now()

  expect(result).toEqual({ ok: true, task: 'a', phase: 'test-review', round: 2 })
  expect(await readPhase(repo.root, 'a')).toEqual({ phase: 'test-review', round: 2, since: standingSince })
  const history = await readPhaseHistory(repo.root, 'a')
  expect(history).toHaveLength(1)
  expect(history?.[0]?.phase).toBe('test-review')
  expect(history?.[0]?.round).toBe(2)
  const since = history?.[0]?.since ?? Number.NaN
  expect(since).toBeGreaterThanOrEqual(t0)
  expect(since).toBeLessThanOrEqual(t1)
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A word change rewrites the phase file with the new word, round, and now, and appends the standing to the history
// GIVEN a queue entry whose phase file records tests-red round 1 since a fixed past moment
// WHEN report_task_phase runs with phase build-green and round 1
// THEN the phase file holds build-green, round 1, and a since inside the call's own instants, and the history holds exactly one entry with that same word, round, and moment
it('rewrites word, round, and since on a word change', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  await writePhase(repo.root, 'a', { phase: 'tests-red', round: 1, since: 1_700_000_000_000 })

  const t0 = Date.now()
  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'build-green', 1)
  const t1 = Date.now()

  expect(result).toEqual({ ok: true, task: 'a', phase: 'build-green', round: 1 })
  const standing = await readPhase(repo.root, 'a')
  expect(standing).toEqual({ phase: 'build-green', round: 1, since: expect.any(Number) })
  const since = standing?.since ?? Number.NaN
  expect(since).toBeGreaterThanOrEqual(t0)
  expect(since).toBeLessThanOrEqual(t1)
  expect(await readPhaseHistory(repo.root, 'a')).toEqual([{ phase: 'build-green', round: 1, since }])
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A report into an entry whose phase file holds no standing to match counts as a word change
// GIVEN queue entries whose phase files hold, one each: nothing at all (with a history already behind it), a word and round with no since, and garbage bytes
// WHEN report_task_phase runs for each with phase build-green and round 1
// THEN each entry's phase file is rewritten with that word, round, and a since inside the call's own instants, and each history gains the standing as its next entry
it('counts a phase file with no standing to match as a word change', async () => {
  const repo = await makeRepo({})
  const past = 1_700_000_000_000
  const cases = [
    {
      task: 'absent',
      label: 'no phase file at all',
      seed: async () => {
        await appendPhaseHistory(repo.root, 'absent', { phase: 'tests-red', round: 1, since: past })
      },
      earlier: [{ phase: 'tests-red', round: 1, since: past }],
    },
    {
      task: 'old-shape',
      label: 'a phase file holding a word and round but no since',
      seed: async () => {
        await writeFile(phasePath(repo.root, 'old-shape'), '{"phase":"build-green","round":1}')
      },
      earlier: [],
    },
    {
      task: 'garbage',
      label: 'garbage bytes in the phase file',
      seed: async () => {
        await writeFile(phasePath(repo.root, 'garbage'), 'not a standing')
      },
      earlier: [],
    },
  ]
  for (const { task, label, seed, earlier } of cases) {
    await writeTask(repo.root, task, { manifest: '{}', state: 'building' })
    await seed()

    const t0 = Date.now()
    const result = await runReportTaskPhase({ queueRoot: repo.root, task }, 'build-green', 1)
    const t1 = Date.now()

    expect(result, label).toEqual({ ok: true, task, phase: 'build-green', round: 1 })
    const standing = await readPhase(repo.root, task)
    expect(standing, label).toEqual({ phase: 'build-green', round: 1, since: expect.any(Number) })
    const since = standing?.since ?? Number.NaN
    expect(since, label).toBeGreaterThanOrEqual(t0)
    expect(since, label).toBeLessThanOrEqual(t1)
    expect(await readPhaseHistory(repo.root, task), label).toEqual([...earlier, { phase: 'build-green', round: 1, since }])
  }
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: The history is appended to, never overwritten — a word that returns stands as its own entry
// GIVEN a queue entry whose history already holds two standings, whose phase file records the second of them
// WHEN report_task_phase runs with the first entry's word and a new round
// THEN both earlier entries stand exactly as they were, and the new standing follows as the history's third entry
it('appends to the history without overwriting earlier standings', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  const firstSince = 1_700_000_000_000
  const secondSince = firstSince + 5_000
  await writePhase(repo.root, 'a', { phase: 'test-review', round: 3, since: secondSince })
  await appendPhaseHistory(repo.root, 'a', { phase: 'tests-red', round: 1, since: firstSince })
  await appendPhaseHistory(repo.root, 'a', { phase: 'test-review', round: 3, since: secondSince })

  const t0 = Date.now()
  await runReportTaskPhase({ queueRoot: repo.root, task: 'a' }, 'tests-red', 2)
  const t1 = Date.now()

  const history = await readPhaseHistory(repo.root, 'a')
  expect(history?.[0]).toEqual({ phase: 'tests-red', round: 1, since: firstSince })
  expect(history?.[1]).toEqual({ phase: 'test-review', round: 3, since: secondSince })
  const since = history?.[2]?.since ?? Number.NaN
  expect(since).toBeGreaterThanOrEqual(t0)
  expect(since).toBeLessThanOrEqual(t1)
  expect(history?.[2]).toEqual({ phase: 'tests-red', round: 2, since })
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: Reporting a phase for a TASK whose queue entry has been pruned is refused as a value, never thrown
// GIVEN a TASK name with no queue entry at all
// WHEN a phase is reported for it
// THEN it refuses as a value naming the TASK, rather than throwing
it('refuses a phase report as a value, never throwing, when the TASK has no queue entry', async () => {
  const repo = await makeRepo({})

  const result = await runReportTaskPhase({ queueRoot: repo.root, task: 'never-queued' }, 'build-green', 1)

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('never-queued') })
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase report with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry, and no PROOFSPEC_QUEUE_ROOT set in the environment
// WHEN the registered phase tool's execute runs
// THEN it refuses, naming PROOFSPEC_QUEUE_ROOT, and the entry is left without a phase file
it('refuses to report a phase when PROOFSPEC_QUEUE_ROOT is not set, writing nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  delete process.env.PROOFSPEC_QUEUE_ROOT
  process.env.PROOFSPEC_TASK = 'a'
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeReportTaskPhase('call-1', { phase: 'explorer' }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_QUEUE_ROOT') })
  expect(await readPhase(repo.root, 'a')).toBeUndefined()
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: A phase report with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written
// GIVEN a real queue entry, and no PROOFSPEC_TASK set in the environment
// WHEN the registered phase tool's execute runs
// THEN it refuses, naming PROOFSPEC_TASK, and the entry is left without a phase file
it('refuses to report a phase when PROOFSPEC_TASK is not set, writing nothing', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  delete process.env.PROOFSPEC_TASK
  const fakeContext = { cwd: repo.root } as unknown as ExtensionContext

  const result = await executeReportTaskPhase('call-1', { phase: 'explorer' }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: false, reason: expect.stringContaining('PROOFSPEC_TASK') })
  expect(await readPhase(repo.root, 'a')).toBeUndefined()
})

// Requirement: report_task_phase reports the executor's own pace word and round
// Scenario: The registered phase tool reports into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory
// GIVEN PROOFSPEC_QUEUE_ROOT/PROOFSPEC_TASK set to a real queue entry, and an ExtensionContext whose cwd names an unrelated directory
// WHEN the registered phase tool's execute runs
// THEN the phase is written under PROOFSPEC_QUEUE_ROOT, not under ExtensionContext.cwd
it('reports the phase into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory', async () => {
  const queueRoot = await makeRepo({})
  const unrelatedCwd = await makeRepo({})
  await writeTask(queueRoot.root, 'a', { manifest: '{}', state: 'building' })
  process.env.PROOFSPEC_QUEUE_ROOT = queueRoot.root
  process.env.PROOFSPEC_TASK = 'a'
  const fakeContext = { cwd: unrelatedCwd.root } as unknown as ExtensionContext

  const result = await executeReportTaskPhase('call-1', { phase: 'tests-red', round: 1 }, undefined, undefined, fakeContext)

  expect(result.details).toEqual({ ok: true, task: 'a', phase: 'tests-red', round: 1 })
  expect(await readPhase(queueRoot.root, 'a')).toEqual({ phase: 'tests-red', round: 1, since: expect.any(Number) })
  await expect(readPhase(unrelatedCwd.root, 'a')).resolves.toBeUndefined()
})

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
// Scenario: The registered tool reports into PROOFSPEC_QUEUE_ROOT even when the session's own working directory names a different directory
// GIVEN PROOFSPEC_QUEUE_ROOT/PROOFSPEC_TASK set to a real queue entry, and the session's own working directory naming an unrelated directory
// WHEN the registered tool's execute runs
// THEN the state is written under PROOFSPEC_QUEUE_ROOT, not under the session's own working directory
it('reports into PROOFSPEC_QUEUE_ROOT even when the session\'s own working directory names a different directory', async () => {
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

// Requirement: A heartbeat is refreshed on every move the session makes
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

// Requirement: A heartbeat is refreshed on every move the session makes
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

// Requirement: A heartbeat is refreshed on every move the session makes
// Scenario: The heartbeat is subscribed to exactly the six observable-move events, and to no others
// GIVEN the extension registered against a recording fake
// WHEN its event subscriptions are read back
// THEN they are exactly the six events the requirement enumerates — no move it names missing, no event it does not name added
// The enumeration in the requirement's prose is definitional: those six moves and no others
// are what count as observable, so the subscription list itself is part of the promise. A
// subscription that silently went missing fails the fireEvent throw above; one that silently
// grew would pass every other test — only this set equality holds both directions to account.
it('subscribes the heartbeat to exactly the six observable-move events, and no others', () => {
  const handlers = registerExtension()

  expect([...handlers.keys()].sort()).toEqual([...OBSERVABLE_MOVES].sort())
})

// Requirement: A heartbeat is refreshed on every move the session makes
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
