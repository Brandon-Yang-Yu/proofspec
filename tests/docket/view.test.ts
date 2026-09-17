// Capability: docket

import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { docket, exitCodeOf } from '../../src/cli/index.ts'
import { writePhase } from '../../src/cli/queue.ts'
import type { Docket } from '../../src/docket/index.ts'
import type { Outcome } from '../../src/cli/index.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

/** The one clock the ages are read against, so a fixture's mtimes and the run's `now` agree. */
const NOW = new Date('2026-09-16T12:00:00.000Z')

function reportOf(outcome: Outcome): Docket {
  if (outcome.kind !== 'docket') throw new Error(`expected a docket report, got ${outcome.kind}`)
  return outcome.report
}

/** A queue entry as a fixture writes one: a MANIFEST naming a branch off main, and a state word. */
function queueEntry(task: string, options: { readonly state?: string; readonly manifest?: string } = {}) {
  const state = options.state ?? 'queued'
  const manifest = options.manifest ?? JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } })
  return {
    [`.proofspec/dispatch/${task}/MANIFEST`]: manifest,
    [`.proofspec/dispatch/${task}/state`]: state,
  }
}

/** Sets a file's write time relative to `NOW`, the fact the two ages are read from. */
async function writtenAgo(repo: { readonly root: string }, path: string, seconds: number): Promise<void> {
  const at = new Date(NOW.getTime() - seconds * 1000)
  await utimes(join(repo.root, path), at, at)
}

/** Runs the docket against `files`, with no session server to ask — the ordinary fixture. */
async function docketOver(files: Readonly<Record<string, string>>) {
  const repo = await makeRepo(files)
  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })
  return { repo, outcome }
}

// Requirement: The docket answers one row per queue entry
// Scenario: A queue directory that does not exist answers an empty docket
// GIVEN a repo with no queue directory at all
// WHEN the docket is answered
// THEN it holds no row, no problem, and no outstanding ruling — the ordinary state between rounds
it('answers an empty docket when the queue directory does not exist', async () => {
  const { outcome } = await docketOver({ 'a.txt': 'a' })

  expect(reportOf(outcome)).toEqual({ rows: [], problems: [], outstanding: [] })
})

// Requirement: The docket answers one row per queue entry
// Scenario: A merged TASK stays on the docket until a pass prunes its entry
// GIVEN a TASK whose state word has reached merged
// WHEN the docket is answered
// THEN the TASK still holds a row, answering merged rather than a silent absence
it('keeps a merged TASK on the docket until a pass prunes its entry', async () => {
  const { outcome } = await docketOver({ ...queueEntry('settled', { state: 'merged' }) })

  expect(reportOf(outcome).rows.map(row => row.state)).toEqual(['merged'])
})

// Requirement: The docket answers one row per queue entry
// Scenario: A state word the docket has never met is shown as it stands, not translated
// GIVEN a TASK whose state file holds a word no capability this view knows has ever produced
// WHEN the docket is answered
// THEN the row carries the word exactly as the state file holds it
it('shows a state word it has never met as it stands', async () => {
  const { outcome } = await docketOver({ ...queueEntry('odd', { state: 'hibernating' }) })

  expect(reportOf(outcome).rows[0]?.state).toBe('hibernating')
})

// Requirement: The docket answers one row per queue entry
// Scenario: Rows come back sorted by TASK name
// GIVEN a queue holding three TASKs entered in an order other than their names
// WHEN the docket is answered
// THEN the rows come back sorted by TASK name, so two runs over the same queue are comparable
it('answers rows sorted by TASK name', async () => {
  const { outcome } = await docketOver({
    ...queueEntry('charlie'),
    ...queueEntry('alpha'),
    ...queueEntry('bravo'),
  })

  expect(reportOf(outcome).rows.map(row => row.task)).toEqual(['alpha', 'bravo', 'charlie'])
})

// Requirement: The docket answers one row per queue entry
// Scenario: A TASK entry that cannot be read answers a problem naming it, with every other TASK's row still standing
// GIVEN a queue holding one TASK whose MANIFEST is not valid JSON beside one whose entry reads fine
// WHEN the docket is answered
// THEN a problem names the unreadable TASK, and the readable TASK's row still stands
it('answers a problem for an unreadable TASK while every other TASK\'s row still stands', async () => {
  const { outcome } = await docketOver({
    ...queueEntry('fine'),
    ...queueEntry('broken', { manifest: 'not json' }),
  })

  const report = reportOf(outcome)
  expect(report.problems.map(problem => problem.task)).toEqual(['broken'])
  expect(report.rows.map(row => row.task)).toEqual(['fine'])
})

// Requirement: A row carries how long the TASK has stood in its word, and when it last moved
// Scenario: A row carries how long it has been since the state file was last written
// GIVEN a TASK whose state file was last written 90 seconds ago
// WHEN the docket is answered
// THEN its row carries 90 seconds as the time the TASK has stood in its word
it('carries the time since the state file was last written', async () => {
  const repo = await makeRepo(queueEntry('a', { state: 'building' }))
  await writtenAgo(repo, '.proofspec/dispatch/a/state', 90)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  expect(reportOf(outcome).rows[0]?.stateAgeSeconds).toBe(90)
})

// Requirement: A row carries how long the TASK has stood in its word, and when it last moved
// Scenario: A row carries how long it has been since the heartbeat was last refreshed
// GIVEN a TASK whose heartbeat file was last refreshed 40 seconds ago
// WHEN the docket is answered
// THEN its row carries 40 seconds as the time since the session last moved
it('carries the time since the heartbeat was last refreshed', async () => {
  const repo = await makeRepo({ ...queueEntry('a', { state: 'building' }), '.proofspec/dispatch/a/heartbeat': '2026-09-16T11:59:20.000Z' })
  await writtenAgo(repo, '.proofspec/dispatch/a/state', 600)
  await writtenAgo(repo, '.proofspec/dispatch/a/heartbeat', 40)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  expect(reportOf(outcome).rows[0]?.heartbeatAgeSeconds).toBe(40)
})

// Requirement: A row carries how long the TASK has stood in its word, and when it last moved
// Scenario: A TASK with no heartbeat file carries the second number as absent, never as a repeat of the first
// GIVEN a TASK with a state file 600 seconds old and no heartbeat file at all
// WHEN the docket is answered
// THEN its row carries 600 for the word and absent for the move, not the word's own age again
it('carries no heartbeat as absent, never as a repeat of the word\'s own age', async () => {
  const repo = await makeRepo(queueEntry('queued-one'))
  await writtenAgo(repo, '.proofspec/dispatch/queued-one/state', 600)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  const row = reportOf(outcome).rows[0]
  expect(row?.stateAgeSeconds).toBe(600)
  expect(row?.heartbeatAgeSeconds).toBeNull()
})

// Requirement: The docket answers one row per queue entry
// Scenario: A row carries the TASK's phase word and round exactly as its phase file holds them
// GIVEN a queue holding one TASK whose phase file holds the word test-review at round 2
// WHEN the docket is answered
// THEN that row carries phase test-review and round 2 exactly as the file holds them
// The phase file is written through the same writer the extension tool uses, so the test pins
// the read against the real bytes, not a fixture's guess at them.
it('carries the phase word and round exactly as the phase file holds them', async () => {
  const repo = await makeRepo({ ...queueEntry('phased', { state: 'building' }) })
  await writePhase(repo.root, 'phased', 'test-review', 2)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  const row = reportOf(outcome).rows[0]
  expect(row?.phase).toBe('test-review')
  expect(row?.round).toBe(2)
})

// Requirement: The docket answers one row per queue entry
// Scenario: A TASK with no phase file carries the phase word and its round both as absent, never invented
// GIVEN a queue holding one TASK with a phase file and one without
// WHEN the docket is answered
// THEN the first row carries its word and round, and the second carries both as absent — never a word guessed, never a round defaulted
it('carries the phase word and round both as absent when there is no phase file', async () => {
  const repo = await makeRepo({
    ...queueEntry('phased', { state: 'building' }),
    ...queueEntry('plain', { state: 'queued' }),
  })
  await writePhase(repo.root, 'phased', 'test-review', 2)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  const rows = reportOf(outcome).rows
  expect(rows.map(row => [row.task, row.phase, row.round])).toEqual([
    ['phased', 'test-review', 2],
    ['plain', null, null],
  ])
})

// Requirement: The docket answers one row per queue entry
// Scenario: A phase word the docket has never met is shown as it stands, not translated
// GIVEN a TASK whose phase file holds a word no capability this view knows has ever produced
// WHEN the docket is answered
// THEN the row carries the word exactly as the phase file holds it
it('shows a phase word it has never met as it stands', async () => {
  const repo = await makeRepo({ ...queueEntry('odd', { state: 'building' }) })
  await writePhase(repo.root, 'odd', 'warping', 4)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  expect(reportOf(outcome).rows[0]?.phase).toBe('warping')
})

// Requirement: A row carries how long the TASK has stood in its word, and when it last moved
// Scenario: A row carries how long it has been since the phase file was last written
// GIVEN a TASK whose state file was last written 600 seconds ago and whose phase file 240 seconds ago
// WHEN the docket is answered
// THEN its row carries 240 as the time since the phase was written — its own file's age, not a repeat of the word's
it('carries the time since the phase file was last written', async () => {
  const repo = await makeRepo(queueEntry('a', { state: 'building' }))
  await writePhase(repo.root, 'a', 'test-review', 2)
  await writtenAgo(repo, '.proofspec/dispatch/a/state', 600)
  await writtenAgo(repo, '.proofspec/dispatch/a/phase', 240)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  const row = reportOf(outcome).rows[0]
  expect(row?.phaseAgeSeconds).toBe(240)
  expect(row?.stateAgeSeconds).toBe(600)
})

// Requirement: A row carries how long the TASK has stood in its word, and when it last moved
// Scenario: A TASK with no phase file carries the third number as absent, never as a repeat of another
// GIVEN a TASK with a state file 600 seconds old and no phase file at all
// WHEN the docket is answered
// THEN its row carries 600 for the word and absent for the phase age — never another number's age dressed up as the phase's
it('carries no phase file as an absent third number, never as a repeat of another', async () => {
  const repo = await makeRepo(queueEntry('plain', { state: 'queued' }))
  await writtenAgo(repo, '.proofspec/dispatch/plain/state', 600)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  const row = reportOf(outcome).rows[0]
  expect(row?.stateAgeSeconds).toBe(600)
  expect(row?.phaseAgeSeconds).toBeNull()
})

// Requirement: The answer names every relationship raised but not yet ruled
// Scenario: A raised entry with no ruling is named with both TASKs, the shared CAPABILITY_FILE or TERM, the key, and the ruling command
// GIVEN a raised-relationships record holding one raised entry and no ruling for it
// WHEN the docket is answered
// THEN the answer names both TASKs, the shared ground, the relationship's key, and the exact command line that records a ruling
it('names a raised-but-unruled relationship with everything a ruling needs', async () => {
  const { outcome } = await docketOver({
    ...queueEntry('alpha'),
    ...queueEntry('beta'),
    '.proofspec/schedule/raised.jsonl': `${JSON.stringify({ kind: 'raised', key: 'capability:spec-tree:alpha,beta', at: '2026-09-16T10:00:00.000Z' })}\n`,
  })

  const outstanding = reportOf(outcome).outstanding
  expect(outstanding).toEqual([
    {
      node: { kind: 'capability', name: 'spec-tree' },
      tasks: ['alpha', 'beta'],
      key: 'capability:spec-tree:alpha,beta',
      answerWith: `proofspec schedule --ruling "<your ruling>" 'capability:spec-tree:alpha,beta'`,
    },
  ])
})

// Requirement: The answer names every relationship raised but not yet ruled
// Scenario: An entry already ruled is absent from the answer
// GIVEN a raised-relationships record holding a raised entry and a later ruling on the same key
// WHEN the docket is answered
// THEN the ruled entry is absent from the answer, because the debt is paid
it('leaves an already-ruled entry out of the answer', async () => {
  const key = 'term:CLAIM:alpha,beta'
  const { outcome } = await docketOver({
    ...queueEntry('alpha'),
    ...queueEntry('beta'),
    '.proofspec/schedule/raised.jsonl': [
      JSON.stringify({ kind: 'raised', key, at: '2026-09-16T10:00:00.000Z' }),
      JSON.stringify({ kind: 'ruled', key, at: '2026-09-16T11:00:00.000Z', ruling: 'not a conflict' }),
    ].join('\n') + '\n',
  })

  expect(reportOf(outcome).outstanding).toEqual([])
})

// Requirement: The docket reports, and judges nothing
// Scenario: The docket writes nothing anywhere
// GIVEN a repo holding a queue with entries and a raised-relationships record
// WHEN the docket is answered
// THEN every file under the repo is byte-for-byte what it was, and no file appears that was not there before
it('writes nothing anywhere', async () => {
  const files = {
    ...queueEntry('alpha', { state: 'building' }),
    ...queueEntry('broken', { manifest: '{' }),
    '.proofspec/schedule/raised.jsonl': `${JSON.stringify({ kind: 'raised', key: 'capability:cli:alpha,broken', at: '2026-09-16T10:00:00.000Z' })}\n`,
  }
  const repo = await makeRepo(files)
  const before = await snapshot(repo.root)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => ['alpha'] } })

  expect(outcome.kind).toBe('docket')
  expect(await snapshot(repo.root)).toEqual(before)
})

/** Every file under a root, by path: its bytes and its write time. */
async function snapshot(root: string): Promise<Readonly<Record<string, { readonly bytes: string; readonly writtenAt: number }>>> {
  const snap: Record<string, { bytes: string; writtenAt: number }> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else snap[full.slice(root.length)] = { bytes: await readFile(full, 'utf8'), writtenAt: (await stat(full)).mtimeMs }
    }
  }
  await walk(root)
  return snap
}

// Requirement: The docket reports, and judges nothing
// Scenario: The docket orders TASKs by name alone, whatever their ages or words
// GIVEN a queue whose oldest TASK sorts after its youngest by name
// WHEN the docket is answered
// THEN the rows still come back in name order — no age, word, or problem moves a TASK up the list
it('orders TASKs by name alone, whatever their ages or words', async () => {
  const repo = await makeRepo({
    ...queueEntry('young', { state: 'blocked-on-question' }),
    ...queueEntry('old', { state: 'queued' }),
  })
  await writtenAgo(repo, '.proofspec/dispatch/old/state', 86_400)
  await writtenAgo(repo, '.proofspec/dispatch/young/state', 5)

  const outcome = await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } })

  expect(reportOf(outcome).rows.map(row => row.task)).toEqual(['old', 'young'])
})

// Requirement: The docket reports, and judges nothing
// Scenario: The docket exits its ok code whatever it finds
// GIVEN a queue holding an unreadable TASK, a word never met before, and an outstanding ruling
// WHEN the docket is answered
// THEN it exits its ok code — a problem, an unknown word, and an unpaid debt are facts it reports, not failures it holds a gate on
it('exits its ok code whatever it finds', async () => {
  const { outcome } = await docketOver({
    ...queueEntry('odd', { state: 'hibernating' }),
    ...queueEntry('broken', { manifest: '{' }),
    '.proofspec/schedule/raised.jsonl': `${JSON.stringify({ kind: 'raised', key: 'capability:cli:broken,odd', at: '2026-09-16T10:00:00.000Z' })}\n`,
  })

  expect(exitCodeOf(outcome)).toBe(0)
})

