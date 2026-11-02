// Capability: progress

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import progressExtension, { executeReportTaskPhase, executeReportTaskState, runReportTaskPhase, runReportTaskState } from '../../src/progress/extension.ts'
import { appendPhaseHistory, readPhase, readPhaseHistory, writePhase } from '../../src/cli/queue.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'
import type { GitRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)

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
// GIVEN a queue entry whose state is building
// WHEN report_task_state is called with a word outside the reportable set
// THEN it refuses, naming the given word, and the entry's state is unchanged
it('refuses a state word outside the reportable set, leaving the entry unchanged', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  const result = await runReportTaskState({ queueRoot: repo.root, task: 'a' }, 'queued')

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('queued') })
  expect(await stateOf(repo.root, 'a')).toBe('building')
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
 *  stripped away — one shape so one Map can hold them all. */
type CapturedHandler = (event: never, ctx: ExtensionContext) => unknown

/** Every handler the extension subscribed, by event. A list per event, not one handler:
 *  the heartbeat and the provider-error watch are separate subscribers on the same API, and
 *  a recorder that kept only the last `on` per event would let one hide the other. */
type Subscriptions = ReadonlyMap<string, readonly CapturedHandler[]>

/** Registers the extension against a fake `ExtensionAPI` that records every `on(event,
 *  handler)` subscription for the test to fire itself. `registerTool` is accepted and
 *  ignored — the tools are another limb's concern. The injection is handed through as
 *  given, so a proof can hand the restart a fire of its own. */
function registerExtension(injection?: unknown): Subscriptions {
  const handlers = new Map<string, CapturedHandler[]>()
  const pi = {
    on: (event: string, handler: CapturedHandler): void => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    registerTool: (): void => {},
  }
  progressExtension(pi as unknown as ExtensionAPI, injection as Parameters<typeof progressExtension>[1])
  return handlers
}

/** Fires every handler subscribed to `event`, in subscription order, awaiting each. The
 *  heartbeat contract ignores the payload, so an empty stand-in serves it; the watch reads
 *  it, so its proofs hand the payload pi would. A missing subscription is itself the
 *  failure — thrown with the event named so the red run says what never arrived. */
async function fireEvent(
  handlers: Subscriptions,
  event: string,
  fire: { readonly payload?: unknown; readonly ctx?: unknown } = {},
): Promise<void> {
  const subscribed = handlers.get(event)
  if (subscribed === undefined || subscribed.length === 0) throw new Error(`the extension subscribed no handler to ${event}`)
  for (const handler of subscribed) {
    await handler((fire.payload ?? {}) as never, (fire.ctx ?? {}) as ExtensionContext)
  }
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
// The extension also subscribes the provider-error watch, so the heartbeat's own
// subscriptions are read back by what they do: every subscribed event is fired alone, with
// the heartbeat deleted before it, and the events that left a heartbeat behind are the
// heartbeat's. The TASK stands queued, so the watch — which acts only on a building TASK —
// writes nothing while it is fired.
it('subscribes the heartbeat to exactly the six observable-move events, and no others', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'queued' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const handlers = registerExtension()

  const refreshing: string[] = []
  for (const event of handlers.keys()) {
    await rm(heartbeatPath(repo.root, 'a'), { force: true })
    await fireEvent(handlers, event, { payload: { type: event, messages: [] }, ctx: { cwd: repo.root } })
    if ((await readHeartbeat(repo.root, 'a')) !== undefined) refreshing.push(event)
  }

  expect(refreshing.sort()).toEqual([...OBSERVABLE_MOVES].sort())
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

// --- the provider-error watch ------------------------------------------------------------

// Every restart in this suite starts its session on this throwaway socket, so nothing here
// can ever reach a real session on the production socket. Set once for the whole file and
// never deleted, the same guard `tests/progress/settle.test.ts` keeps: a restart runs in a
// process of its own and reads the socket when it starts, which may be after the test that
// fired it has finished.
const RESTART_SOCKET = 'proofspec-restart-test'
process.env.PROOFSPEC_TMUX_SOCKET = RESTART_SOCKET
afterEach(async () => {
  await execFileAsync('tmux', ['-L', RESTART_SOCKET, 'kill-server']).catch(() => {})
})

/** The state words a TASK can stand at other than building — the ones a provider-error stop
 *  must leave alone. */
const NOT_BUILDING = ['queued', 'mergeable', 'blocked-on-question', 'merged'] as const

/** Every way pi records a reply ending other than on a provider error — each `StopReason`
 *  `@earendil-works/pi-ai` declares except `error`. Spelled out rather than imported: pi-ai
 *  is not a direct dependency, and a new reason pi adds should be a decision here, not a
 *  silent widening. */
const NON_ERROR_ENDINGS = ['stop', 'length', 'toolUse', 'aborted', 'pending', 'deferred'] as const

/** A reply as pi's agent loop records it, ended the way `stopReason` names. The fields past
 *  the stop are filler the watch has no business reading. */
function replyEndingOn(stopReason: (typeof NON_ERROR_ENDINGS)[number] | 'error'): Record<string, unknown> {
  return {
    role: 'assistant',
    content: stopReason === 'error' ? [] : [{ type: 'text', text: 'done for now' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    ...(stopReason === 'error' ? { errorMessage: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' } : {}),
    timestamp: Date.now(),
  }
}

/** One agent run ending, its last reply last among the messages — pi's `agent_end`. */
async function endRun(handlers: Subscriptions, lastReply: Record<string, unknown>, ctx: unknown): Promise<void> {
  const prompt = { role: 'user', content: 'carry on', timestamp: Date.now() }
  await fireEvent(handlers, 'agent_end', { payload: { type: 'agent_end', messages: [prompt, lastReply] }, ctx })
}

/** The session stopping for good — pi's `agent_settled`, fired once no automatic retry,
 *  compaction, or queued continuation will run. */
async function settle(handlers: Subscriptions, ctx: unknown): Promise<void> {
  await fireEvent(handlers, 'agent_settled', { payload: { type: 'agent_settled' }, ctx })
}

/** A run ending on `lastReply`, and the session then stopping and not going on by itself. */
async function stopForGood(handlers: Subscriptions, lastReply: Record<string, unknown>, ctx: unknown): Promise<void> {
  await endRun(handlers, lastReply, ctx)
  await settle(handlers, ctx)
}

function executorPath(root: string, task: string): string {
  return join(root, '.proofspec', 'dispatch', task, 'executor')
}

/** The TASK's executor record, or `undefined` while none stands. */
async function readExecutor(root: string, task: string): Promise<string | undefined> {
  try {
    return await readFile(executorPath(root, task), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** A restart fire that starts nothing and counts how often it was handed control — the
 *  "no session is started" half of every proof that expects the watch to stay still. */
function countingFire(): { readonly fireRestart: () => void; readonly count: () => number } {
  let fired = 0
  return {
    fireRestart: () => {
      fired += 1
    },
    count: () => fired,
  }
}

/** Waits for `path` to appear, answering whether it did before the deadline. */
async function appearsWithin(path: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return existsSync(path)
}

/** Whether the process with the given pid is gone, polled until the deadline. A signal-0
 *  probe alone is not enough: it succeeds on a zombie, which a killed process stays until
 *  its parent reaps it — so a zombie counts as gone. */
async function isGoneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (true) {
    if (await isGone(pid)) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function isGone(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return true
  }
  const ps = await execFileAsync('ps', ['-o', 'stat=', '-p', String(pid)]).catch(() => ({ stdout: '' }))
  const processState = ps.stdout.trim()
  return processState === '' || processState.startsWith('Z')
}

/** A real ProofSpec queue with one building TASK whose worktree stands at its conventional
 *  path, the executor persona startSession reads, and a fake `claude` first on PATH that
 *  records the arguments it was handed and the folder it was started in, and then parks —
 *  never the real claude: an unattended start in a test has no business running it. Hands
 *  back what a proof reads, and a restore that puts PATH back as it was. */
async function makeBuildingTaskWithFakeClaude(task: string): Promise<{
  readonly repo: GitRepo
  readonly worktree: string
  readonly claudeRanIn: string
  readonly claudeArgv: string
  readonly bin: string
  readonly restore: () => Promise<void>
}> {
  const bin = await mkdtemp(join(tmpdir(), 'proofspec-restart-claude-'))
  const claudeRanIn = join(bin, 'claude-ran-in')
  const claudeArgv = join(bin, 'claude-argv')
  // Each record is written aside and moved into place: `>` creates the file before the
  // writer runs, so a proof polling for it could otherwise read it empty. The arguments go
  // NUL-separated, since the kickoff and the system prompt carry newlines of their own, and
  // land before the folder does, so a proof that saw the folder can read them at once.
  await writeFile(
    join(bin, 'claude'),
    [
      '#!/bin/sh',
      `printf '%s\\0' "$@" > ${JSON.stringify(`${claudeArgv}.tmp`)}`,
      `mv ${JSON.stringify(`${claudeArgv}.tmp`)} ${JSON.stringify(claudeArgv)}`,
      `pwd -P > ${JSON.stringify(`${claudeRanIn}.tmp`)}`,
      `mv ${JSON.stringify(`${claudeRanIn}.tmp`)} ${JSON.stringify(claudeRanIn)}`,
      'sleep 60',
      '',
    ].join('\n'),
  )
  await chmod(join(bin, 'claude'), 0o755)
  const repo = await makeGitRepo({ 'a.txt': 'a', '.pi/agents/executor.md': 'You are the executor.\n' })
  await enterTask(repo, task, { edit: 'a.txt' })
  await repo.write(`.proofspec/dispatch/${task}/state`, 'building')
  const worktree = join(repo.root, '.proofspec', 'worktrees', task)
  await repo.git(['worktree', 'add', worktree, `work/${task}`])

  // The restart must reach claude only through the executor record it writes for the TASK:
  // the queue root holds no settings file, so its executor is the default pi, and a start
  // that ran claude anyway can only have read the record.
  expect(existsSync(join(repo.root, '.proofspec', 'config.json'))).toBe(false)
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}:${previousPath ?? ''}`
  // A server started earlier would answer with its older PATH, which holds no fake claude.
  await execFileAsync('tmux', ['-L', RESTART_SOCKET, 'kill-server']).catch(() => {})

  const restore = async (): Promise<void> => {
    await execFileAsync('tmux', ['-L', RESTART_SOCKET, 'kill-server']).catch(() => {})
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(bin, { recursive: true, force: true })
  }
  return { repo, worktree, claudeRanIn, claudeArgv, bin, restore }
}

/** The arguments the fake claude recorded, in order. */
async function readArgv(path: string): Promise<readonly string[]> {
  const recorded = await readFile(path, 'utf8')
  return recorded.split('\0').slice(0, -1)
}

/** Holds the recorded claude arguments to the invocation only startSession builds for the
 *  claude harness: the executor's own system prompt appended, permissions skipped, and a
 *  generated MCP config naming exactly one server, under the queue root — never a bare
 *  `claude` some other path could have started. */
async function expectStartSessionClaude(argv: readonly string[], queueRoot: string): Promise<void> {
  const promptIndex = argv.indexOf('--append-system-prompt-file')
  expect(promptIndex, 'claude was handed no --append-system-prompt-file').toBeGreaterThan(-1)
  await expect(readFile(argv[promptIndex + 1] ?? '', 'utf8')).resolves.toContain('You are the executor.')
  expect(argv).toContain('--dangerously-skip-permissions')
  const configIndex = argv.indexOf('--mcp-config')
  expect(configIndex, 'claude was handed no --mcp-config').toBeGreaterThan(-1)
  const config = JSON.parse(await readFile(argv[configIndex + 1] ?? '', 'utf8')) as { mcpServers?: Record<string, { args?: string[] }> }
  const servers = Object.values(config.mcpServers ?? {})
  expect(servers.length, 'the config must name exactly one MCP server').toBe(1)
  const roots = [queueRoot, await realpath(queueRoot)]
  const entry = servers[0]?.args?.at(-1) ?? ''
  expect(roots.some(root => entry.startsWith(`${root}/`)), `the MCP server ${entry} is not under the queue root`).toBe(true)
}

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: A pi session that stops for good on a provider error while its TASK is building records claude as the TASK's executor and starts the TASK again in the claude harness, in the same worktree
// GIVEN a pi executor session with PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK set, its TASK's state word building, and its last reply ended on an error from the model provider
// WHEN the session stops and will not go on by itself
// THEN the TASK's queue entry's executor file holds claude, and the TASK's session is started again through startSession in the TASK's same worktree, running the claude harness
// The restart is the real one — no fire injected — so what it started is read off the
// world: a tmux session named for the TASK on the dedicated server, and the fake claude's
// own record of the folder it was started in.
it('records claude as the executor and restarts the TASK in the claude harness, in the same worktree, on a provider-error stop while building', async () => {
  const { repo, worktree, claudeRanIn, claudeArgv, restore } = await makeBuildingTaskWithFakeClaude('a')
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  try {
    const handlers = registerExtension()

    await stopForGood(handlers, replyEndingOn('error'), { cwd: worktree })

    expect(await readExecutor(repo.root, 'a')).toBe('claude')
    expect(await appearsWithin(claudeRanIn, 15000), 'the restart never started claude').toBe(true)
    expect((await readFile(claudeRanIn, 'utf8')).trim()).toBe(await realpath(worktree))
    await expectStartSessionClaude(await readArgv(claudeArgv), repo.root)
    const sessions = await execFileAsync('tmux', ['-L', RESTART_SOCKET, 'list-sessions', '-F', '#{session_name}'])
    expect(sessions.stdout.split('\n').filter(Boolean)).toEqual(['a'])
  } finally {
    await restore()
  }
}, 30000)

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: The executor record is written before the restart starts
// GIVEN a pi session stopped for good on a provider error while its TASK is building
// WHEN the TASK's session is started again
// THEN the queue entry's executor file already holds claude at the moment the restart starts
// The ordering is observed from inside the fire itself, the settle suite's way: the injected
// fire reads the entry at the moment it is handed control, and starts nothing. The read is
// synchronous on purpose — the real fire is spawn-and-unref, so a build may call it without
// awaiting, and an awaited read here could resolve only after a write that came later.
it('writes the executor record before the restart starts', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const seenAtFire: (string | undefined)[] = []
  const handlers = registerExtension({
    fireRestart: () => {
      const path = executorPath(repo.root, 'a')
      seenAtFire.push(existsSync(path) ? readFileSync(path, 'utf8') : undefined)
    },
  })

  await stopForGood(handlers, replyEndingOn('error'), { cwd: repo.root })

  expect(seenAtFire).toEqual(['claude'])
})

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: The restart runs in a process of its own and finishes even though the pi session is killed
// GIVEN a pi session stopped for good on a provider error while its TASK is building
// WHEN the restart is fired and the pi session's own process then ends, the way starting the new session kills it
// THEN the restart runs in a process detached from the pi session, and the TASK's new session is still started
// The pi session is played for real: a node process hosting the extension inside a tmux
// session named for the TASK on the dedicated server — exactly where startSession puts an
// executor — so the restart's own start kills the very session that fired it. A restart
// that lived in the pi session's process group dies with that kill before it can start
// anything; only one running in a process of its own gets as far as starting claude.
it('finishes the restart in a detached process even though starting the new session kills the pi session', async () => {
  const { repo, worktree, claudeRanIn, bin, restore } = await makeBuildingTaskWithFakeClaude('a')
  const extensionUrl = new URL('../../src/progress/extension.ts', import.meta.url)
  const host = join(bin, 'pi-session.mjs')
  const piPidFile = join(bin, 'pi-pid')
  // The host names its own pid before it fires anything — written aside and renamed into
  // place, so the file is never seen half-written — because asking tmux for the pane's pid
  // after new-session returns could race a restart fast enough to have already replaced it.
  await writeFile(host, `
import { renameSync, writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(`${piPidFile}.tmp`)}, String(process.pid))
renameSync(${JSON.stringify(`${piPidFile}.tmp`)}, ${JSON.stringify(piPidFile)})
const mod = await import(${JSON.stringify(extensionUrl.href)})
const handlers = new Map()
const pi = { on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]), registerTool: () => {} }
mod.default(pi)
const ctx = { cwd: process.cwd() }
const fire = async (event, payload) => { for (const handler of handlers.get(event) ?? []) await handler(payload, ctx) }
await fire('agent_end', { type: 'agent_end', messages: [${JSON.stringify(replyEndingOn('error'))}] })
await fire('agent_settled', { type: 'agent_settled' })
setInterval(() => {}, 1000)
`)
  try {
    await execFileAsync('tmux', [
      '-L', RESTART_SOCKET, 'new-session', '-d', '-s', 'a', '-c', worktree,
      '-e', `PROOFSPEC_QUEUE_ROOT=${repo.root}`, '-e', 'PROOFSPEC_TASK=a',
      '-e', `PROOFSPEC_TMUX_SOCKET=${RESTART_SOCKET}`, '-e', `PATH=${process.env.PATH ?? ''}`,
      process.execPath, '--experimental-transform-types', host,
    ])
    expect(await appearsWithin(piPidFile, 20000), 'the pi session never started').toBe(true)
    const piPid = Number(await readFile(piPidFile, 'utf8'))

    expect(await appearsWithin(claudeRanIn, 20000), 'the restart never started claude').toBe(true)
    expect((await readFile(claudeRanIn, 'utf8')).trim()).toBe(await realpath(worktree))
    expect(await readExecutor(repo.root, 'a')).toBe('claude')
    // The pi session did die — the restart finished despite that, not because it was spared.
    expect(await isGoneWithin(piPid, 5000), 'the pi session outlived the restart').toBe(true)
  } finally {
    await restore()
  }
}, 40000)

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: A stop whose last reply did not end on a provider error triggers nothing
// GIVEN a pi session whose TASK is building, and whose last reply ended without a provider error
// WHEN the session stops and will not go on by itself
// THEN no executor file is written and no session is started
// Every ending pi records other than `error` stands for "without a provider error": a reply
// that finished, one cut off at its length limit, one handing over to a tool call, one the
// human aborted, and the two pi leaves open. None is the provider failing, so a watch that
// read "anything but a clean stop" as a provider error is caught here.
it('triggers nothing when the last reply before the stop did not end on a provider error', async () => {
  const repo = await makeRepo({})
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  for (const ending of NON_ERROR_ENDINGS) {
    await writeTask(repo.root, ending, { manifest: '{}', state: 'building' })
    process.env.PROOFSPEC_TASK = ending
    const fire = countingFire()
    const handlers = registerExtension({ fireRestart: fire.fireRestart })

    await stopForGood(handlers, replyEndingOn(ending), { cwd: repo.root })

    expect(await readExecutor(repo.root, ending), `an executor record after a reply ending on ${ending}`).toBeUndefined()
    expect(fire.count(), `a restart after a reply ending on ${ending}`).toBe(0)
  }
})

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: A provider-error stop while the TASK is in any state other than building triggers nothing
// GIVEN a pi session whose last reply ended on a provider error, and its TASK's state word each of the words other than building in turn
// WHEN the session stops and will not go on by itself
// THEN for every such word, no executor file is written, no session is started, and the state word stands as it was
it('triggers nothing on a provider-error stop while the TASK stands at any word other than building', async () => {
  const repo = await makeRepo({})
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  for (const word of NOT_BUILDING) {
    await writeTask(repo.root, word, { manifest: '{}', state: word })
    process.env.PROOFSPEC_TASK = word
    const fire = countingFire()
    const handlers = registerExtension({ fireRestart: fire.fireRestart })

    await stopForGood(handlers, replyEndingOn('error'), { cwd: repo.root })

    expect(await readExecutor(repo.root, word), `an executor record for a TASK at ${word}`).toBeUndefined()
    expect(fire.count(), `a restart for a TASK at ${word}`).toBe(0)
    expect(await stateOf(repo.root, word)).toBe(word)
  }
})

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: A provider-error stop with PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK unset triggers nothing
// GIVEN a pi session whose last reply ended on a provider error, with PROOFSPEC_QUEUE_ROOT unset, and then with PROOFSPEC_TASK unset
// WHEN the session stops and will not go on by itself
// THEN each time no executor file is written anywhere and no session is started
// "Anywhere" is held to every place a guess could land: the building TASK's own entry, the
// session's own directory, this process's own working directory, and the queue root and
// TASK name read off a worktree's conventional path — the fallbacks the watch must never
// reach for. The session's directory and the process's directory each hold a building TASK
// `a` of their own, so a watch that fell back to either would find a TASK to move there.
// Each unset case also runs from `<repo>/.proofspec/worktrees/a`, so a watch that took the
// TASK from the directory's name, or the queue root from three levels above it, would land
// on the building TASK `a` under the repo, and be caught writing its record or firing the
// restart. The repo is a real git repo and the conventional path a real `git worktree add`,
// so a watch that asked git for the main checkout (`git rev-parse --git-common-dir` from the
// session's directory) would find the repo and be caught, not fail quietly.
// The process's directory mirrors production, where pi runs inside the TASK's worktree: it
// is the conventional worktree `<processRepo>/.proofspec/worktrees/a` of a second real git
// repo whose main checkout holds a building TASK `a` too. So a watch that asked git for the
// main checkout from `process.cwd()`, or read the TASK and queue root off the process's
// directory's path, would land on that TASK and be caught as well.
it('triggers nothing on a provider-error stop when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  const sessionDir = await makeRepo({})
  const processRepo = await makeGitRepo({ 'p.txt': 'p' })
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  await writeTask(sessionDir.root, 'a', { manifest: '{}', state: 'building' })
  await writeTask(processRepo.root, 'a', { manifest: '{}', state: 'building' })
  const conventionalWorktree = join(repo.root, '.proofspec', 'worktrees', 'a')
  await repo.git(['worktree', 'add', '-b', 'work/a', conventionalWorktree])
  const processDir = join(processRepo.root, '.proofspec', 'worktrees', 'a')
  await processRepo.git(['worktree', 'add', '-b', 'work/a', processDir])
  await writeTask(processDir, 'a', { manifest: '{}', state: 'building' })
  const unsets = [
    { label: 'PROOFSPEC_QUEUE_ROOT unset', env: { PROOFSPEC_TASK: 'a' } },
    { label: 'PROOFSPEC_TASK unset', env: { PROOFSPEC_QUEUE_ROOT: repo.root } },
  ]
  const sessionCwds = [
    { where: 'from a directory of its own', cwd: sessionDir.root },
    { where: "from the TASK's conventional worktree path", cwd: conventionalWorktree },
  ]
  const previousCwd = process.cwd()
  process.chdir(processDir)
  try {
    for (const { label, env } of unsets) {
      for (const { where, cwd } of sessionCwds) {
        delete process.env.PROOFSPEC_QUEUE_ROOT
        delete process.env.PROOFSPEC_TASK
        Object.assign(process.env, env)
        const fire = countingFire()
        const handlers = registerExtension({ fireRestart: fire.fireRestart })

        await stopForGood(handlers, replyEndingOn('error'), { cwd })

        const at = `${label}, ${where}`
        expect(await readExecutor(repo.root, 'a'), at).toBeUndefined()
        expect(await readExecutor(sessionDir.root, 'a'), `${at}: a record under the session's own directory`).toBeUndefined()
        expect(await readExecutor(processDir, 'a'), `${at}: a record under the process's own directory`).toBeUndefined()
        expect(await readExecutor(processRepo.root, 'a'), `${at}: a record under the main checkout of the process's worktree`).toBeUndefined()
        expect(fire.count(), at).toBe(0)
      }
    }
  } finally {
    process.chdir(previousCwd)
  }
})

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: The watch reads the TASK's entry under PROOFSPEC_QUEUE_ROOT even when the session's own directory is a different one
// GIVEN a pi session whose working directory is the TASK's worktree, PROOFSPEC_QUEUE_ROOT naming the main checkout, the TASK building there, and its last reply ended on a provider error
// WHEN the session stops and will not go on by itself
// THEN the executor record is written into the queue entry under PROOFSPEC_QUEUE_ROOT, and nothing is written under the session's own directory
it('reads and writes the TASK\'s entry under PROOFSPEC_QUEUE_ROOT even when the session\'s own directory is a different one', async () => {
  const queueRoot = await makeRepo({})
  const sessionDir = await makeRepo({})
  await writeTask(queueRoot.root, 'a', { manifest: '{}', state: 'building' })
  process.env.PROOFSPEC_QUEUE_ROOT = queueRoot.root
  process.env.PROOFSPEC_TASK = 'a'
  const fire = countingFire()
  const handlers = registerExtension({ fireRestart: fire.fireRestart })

  await stopForGood(handlers, replyEndingOn('error'), { cwd: sessionDir.root })

  expect(await readExecutor(queueRoot.root, 'a')).toBe('claude')
  expect(fire.count()).toBe(1)
  await expect(stat(join(sessionDir.root, '.proofspec'))).rejects.toThrow()
})

// Requirement: A pi executor session that stops on a provider error while its TASK is building restarts the TASK in the claude harness
// Scenario: A provider error the session still goes on from by itself triggers nothing
// GIVEN a pi session whose TASK is building, and a reply that ended on a provider error which the session still goes on from by itself
// WHEN that reply ends
// THEN no executor file is written and no session is started
// pi ends the run on the failed reply and then retries on its own, so the proof plays that
// out: the failed run ends, then — the retry having gone through — a run ending on a finished
// reply, and only then the stop for good. Nothing may move at either point: not when the
// failed reply ends, and not at the stop, whose last reply did not fail.
it('triggers nothing on a provider error the session still goes on from by itself', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'a'
  const fire = countingFire()
  const handlers = registerExtension({ fireRestart: fire.fireRestart })
  const ctx = { cwd: repo.root }

  await endRun(handlers, replyEndingOn('error'), ctx)

  expect(await readExecutor(repo.root, 'a'), 'an executor record as the failed reply ended').toBeUndefined()
  expect(fire.count(), 'a restart as the failed reply ended').toBe(0)

  await stopForGood(handlers, replyEndingOn('stop'), ctx)

  expect(await readExecutor(repo.root, 'a'), 'an executor record at the stop after the retry went through').toBeUndefined()
  expect(fire.count(), 'a restart at the stop after the retry went through').toBe(0)
})
