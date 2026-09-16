// Capability: docket

import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { docket, renderAnswer, serveDocket } from '../../src/cli/index.ts'
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
