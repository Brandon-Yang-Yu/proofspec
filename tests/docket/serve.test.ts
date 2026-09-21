// Capability: docket

import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { docket, renderAnswer, serveDocket } from '../../src/cli/index.ts'
import { writePhase } from '../../src/cli/queue.ts'
import type { StandingServe } from '../../src/cli/index.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

// The one clock the served answers are computed against, frozen: two requests over a queue
// that has not moved then read the same ages, which is what makes "identically" provable.
const NOW = new Date('2026-09-16T12:00:00.000Z')

function manifestFor(task: string): string {
  return JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } })
}

/** A queue a page would be left open on: one working TASK, one problem, one unpaid ruling. */
const FILES = {
  '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
  '.proofspec/dispatch/alpha/state': 'building',
  '.proofspec/dispatch/broken/MANIFEST': '{',
  '.proofspec/dispatch/broken/state': 'queued',
  '.proofspec/schedule/raised.jsonl': `${JSON.stringify({ kind: 'raised', key: 'capability:spec-tree:alpha,beta', at: '2026-09-16T10:00:00.000Z' })}\n`,
}

const standing: StandingServe[] = []

// Stopped before the repos go: a stopped server asks the queue nothing.
afterEach(async () => {
  await Promise.all(standing.splice(0).map(server => server.stop()))
})
afterEach(cleanupRepos)

/** Serves the docket over a fixture queue on a port nothing holds, with no session server
 *  to ask and the clock frozen at `NOW`. */
async function serveOver(files: Readonly<Record<string, string>>) {
  const repo = await makeRepo(files)
  const served = await serveDocket({ cwd: repo.root, port: await freePort(), docket: { listSessions: async () => [] }, now: () => NOW })
  if (!served.ok) throw new Error(`serving did not start: ${served.reason}`)
  standing.push(served)
  return { repo, served }
}

/** A port nothing holds, found by asking the OS for one and giving it back. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/** One request's body, fetched the way the page fetches it. */
async function get(path: string, port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  return response.text()
}

// Requirement: The docket answers on a page
// Scenario: The page answered at / carries the docket computed at that moment
// GIVEN a served docket whose queue holds a TASK with a phase file
// WHEN the page at / is fetched, and the JSON the page reads at /docket
// THEN the page's markup carries the TASK's phase word and its round as visible content, and the JSON carries the same row with its phase fields — one view, asked twice, answering the same moment
it('answers the page at / with the docket computed at that moment', async () => {
  const { repo, served } = await serveOver(FILES)
  await writePhase(repo.root, 'alpha', 'test-review', 2)

  const page = await get('/', served.port)
  const json = JSON.parse(await get('/docket', served.port)) as { rows: { task: string; phase: string | null; round: number | null; phaseAgeSeconds: number | null }[] }

  expect(page).toContain('test-review')
  expect(page).toContain('round 2')
  expect(json.rows).toEqual([
    expect.objectContaining({ task: 'alpha', phase: 'test-review', round: 2 }),
  ])
  expect(typeof json.rows[0]?.phaseAgeSeconds).toBe('number')
})

// Requirement: The docket answers on a page
// Scenario: The JSON answered at /docket is the same content the one-shot JSON form gives
// GIVEN a queue holding a TASK, a problem, and an outstanding ruling
// WHEN the page's JSON is fetched from /docket while the one-shot command is run as JSON over the same queue at the same moment
// THEN the two answers carry the same content — rows, problems, and outstanding rulings alike — nothing on the page is a dialect of its own
it('answers at /docket the same content the one-shot JSON form gives', async () => {
  const { repo, served } = await serveOver(FILES)

  const oneShot = renderAnswer(await docket({ cwd: repo.root, now: NOW, docket: { listSessions: async () => [] } }), { format: 'json' })
  const fetched = await get('/docket', served.port)

  expect(JSON.parse(fetched)).toEqual(JSON.parse(oneShot))
})

// Requirement: The docket answers on a page
// Scenario: Each request answers the docket computed fresh, as that moment holds it
// GIVEN a served docket whose queue holds one TASK, and a second TASK entered after the server started
// WHEN the page's JSON is fetched again
// THEN the new TASK's row is in the answer — the docket as that moment holds it, never as the server started
it('computes the docket fresh on each request it answers', async () => {
  const { repo, served } = await serveOver({
    '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
    '.proofspec/dispatch/alpha/state': 'building',
  })

  expect(JSON.parse(await get('/docket', served.port)).rows.map((row: { task: string }) => row.task)).toEqual(['alpha'])

  const beta = join(repo.root, '.proofspec', 'dispatch', 'beta')
  await mkdir(beta, { recursive: true })
  await writeFile(join(beta, 'MANIFEST'), manifestFor('beta'))
  await writeFile(join(beta, 'state'), 'queued')

  expect(JSON.parse(await get('/docket', served.port)).rows.map((row: { task: string }) => row.task)).toEqual(['alpha', 'beta'])
})

// Requirement: The docket answers on a page
// Scenario: A queue that has not moved between two requests answers those two requests identically
// GIVEN a served docket, its clock frozen, and nothing written to the queue between two requests
// WHEN the page's JSON is fetched twice
// THEN the two answers are byte for byte identical — nothing on the page is a cache, a prediction, or the residue of an earlier glance
it('answers two requests over an unmoved queue identically', async () => {
  const { served } = await serveOver(FILES)

  const first = await get('/docket', served.port)
  const second = await get('/docket', served.port)

  expect(second).toBe(first)
})

// --- the archive of completed TASKs ------------------------------------------------------------

/** The one archive fixture's moments, pinned so the record's fields and duration have exact
 *  values to check against: enqueued 09:00, settled 10:30 — ninety minutes. */
const ENQUEUED_AT = new Date('2025-01-01T09:00:00.000Z')
const SETTLED_AT = new Date('2025-01-01T10:30:00.000Z')

/** An archived entry as the prune leaves one, with both write times pinned by hand. */
async function writeArchived(root: string, task: string, options: { readonly enqueuedAt: Date; readonly settledAt: Date }): Promise<void> {
  const dir = join(root, '.proofspec', 'archive', task)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'MANIFEST'), manifestFor(task))
  await writeFile(join(dir, 'state'), 'merged')
  await utimes(join(dir, 'MANIFEST'), options.enqueuedAt, options.enqueuedAt)
  await utimes(join(dir, 'state'), options.settledAt, options.settledAt)
}

async function archiveAnswer(port: number): Promise<{ records: { task: string; branch: string; base: { kind: string }; enqueuedAt: string; settledAt: string; livedSeconds: number }[] }> {
  return JSON.parse(await get('/archive', port))
}

// Requirement: The page answers the archive of completed TASKs
// Scenario: The archive answer carries one record per archived TASK, each holding the fields read from its own files
// GIVEN an archive holding one completed TASK, its two write times pinned by hand
// WHEN the archive's JSON is fetched
// THEN it carries exactly one record for it — the TASK's name, the branch and base its MANIFEST records, and the two moments and the duration read from its own files' write times
it('answers one record per archived TASK with its own files\' facts', async () => {
  const { repo, served } = await serveOver({})
  await writeArchived(repo.root, 'first', { enqueuedAt: ENQUEUED_AT, settledAt: SETTLED_AT })

  const answer = await archiveAnswer(served.port)

  expect(answer.records).toEqual([
    {
      task: 'first',
      branch: 'work/first',
      base: { kind: 'main' },
      enqueuedAt: ENQUEUED_AT.toISOString(),
      settledAt: SETTLED_AT.toISOString(),
      livedSeconds: 90 * 60,
    },
  ])
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The records come back ordered by start time, earliest first
// GIVEN an archive holding two completed TASKs whose name order, start order, and settle order all disagree
// WHEN the archive's JSON is fetched
// THEN the records come back in start order, earliest first — neither the names nor the settled moments impose their order here, and the live rows' own name sort is not imposed either
it('orders the archive records by start time, earliest first', async () => {
  const { repo, served } = await serveOver({})
  // zeta started first but settled later; alpha started later but settled first — only the
  // start order answers, so a sort on settled moments or on names is the wrong sort.
  await writeArchived(repo.root, 'zeta', { enqueuedAt: ENQUEUED_AT, settledAt: new Date('2025-01-01T11:00:00.000Z') })
  await writeArchived(repo.root, 'alpha', { enqueuedAt: new Date(ENQUEUED_AT.getTime() + 30 * 60 * 1000), settledAt: SETTLED_AT })

  const answer = await archiveAnswer(served.port)

  expect(answer.records.map(record => record.task)).toEqual(['zeta', 'alpha'])
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: An archive that holds no TASK answers an empty list of records
// GIVEN a served docket whose archive directory holds nothing — the ordinary state until the first prune archives
// WHEN the archive's JSON is fetched
// THEN it answers an empty list of records, the same honest absence an empty docket keeps
it('answers an empty archive as an empty list of records', async () => {
  const { served } = await serveOver(FILES)

  const answer = await archiveAnswer(served.port)

  expect(answer.records).toEqual([])
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The archive answer is computed fresh on each request
// GIVEN a served docket, an archive holding one completed TASK, and the settled moment moved by hand after the server started
// WHEN the archive's JSON is fetched again
// THEN the record's settled moment follows the file's new write time — every number is computed on the request that asks for it, never held from an earlier answer
it('computes the archive answer fresh on each request', async () => {
  const { repo, served } = await serveOver({})
  await writeArchived(repo.root, 'first', { enqueuedAt: ENQUEUED_AT, settledAt: SETTLED_AT })
  const first = await archiveAnswer(served.port)

  const moved = new Date('2025-01-01T11:00:00.000Z')
  await utimes(join(repo.root, '.proofspec', 'archive', 'first', 'state'), moved, moved)
  const second = await archiveAnswer(served.port)

  expect(second.records[0]?.settledAt).toBe(moved.toISOString())
  expect(second.records[0]?.livedSeconds).toBe(120 * 60)
  expect(first.records[0]?.settledAt).toBe(SETTLED_AT.toISOString())
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The docket's own answer is unchanged by the archive's presence
// GIVEN a served docket whose archive holds one completed TASK and whose queue holds one live TASK
// WHEN the page's JSON is fetched from /docket
// THEN the rows carry exactly the live TASK and nothing else — what stands on the queue now and what has finished are two questions, and the archive is the second one, not more rows of the first
it('leaves the docket\'s own answer unchanged by the archive\'s presence', async () => {
  const { repo, served } = await serveOver({
    '.proofspec/dispatch/third/MANIFEST': manifestFor('third'),
    '.proofspec/dispatch/third/state': 'building',
  })
  await writeArchived(repo.root, 'first', { enqueuedAt: ENQUEUED_AT, settledAt: SETTLED_AT })

  const rows = JSON.parse(await get('/docket', served.port)).rows as { task: string }[]

  expect(rows.map(row => row.task)).toEqual(['third'])
})
