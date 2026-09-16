// Capability: cli

import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { serveDocket } from '../../src/cli/index.ts'
import type { StandingServe } from '../../src/cli/index.ts'
import { cleanupRepos, makeRepo } from './support.ts'

const standing: StandingServe[] = []

// Stopped before the repos go: a stopped server asks the queue nothing.
afterEach(async () => {
  await Promise.all(standing.splice(0).map(server => server.stop()))
})
afterEach(cleanupRepos)

function manifestFor(task: string): string {
  return JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } })
}

const FILES = {
  '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
  '.proofspec/dispatch/alpha/state': 'building',
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

/** Serves the docket over a fixture queue, on the port named (or the default when none is). */
async function serveOver(files: Readonly<Record<string, string>>, options: { readonly port?: number } = {}) {
  const repo = await makeRepo(files)
  const served = await serveDocket({ cwd: repo.root, port: options.port, docket: { listSessions: async () => [] } })
  if (!served.ok) throw new Error(`serving did not start: ${served.reason}`)
  standing.push(served)
  return served
}

/** One request, as the page or a curl makes it. */
async function request(path: string, port: number): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`)
}

// Requirement: A command serves the docket as a page
// Scenario: Asked to serve, the command answers the page at / and the JSON the page reads at /docket
// GIVEN the docket command asked to serve over a queue holding a TASK
// WHEN / and /docket are fetched
// THEN / answers HTML — the page a browser opens — and /docket answers JSON carrying the TASK's row
it('answers the page at / and the JSON the page reads at /docket', async () => {
  const served = await serveOver(FILES)

  const page = await request('/', served.port)
  expect(page.headers.get('content-type')).toContain('text/html')
  expect(await page.text()).toContain('<!doctype html>')

  const json = await request('/docket', served.port)
  expect(json.headers.get('content-type')).toContain('application/json')
  const parsed = JSON.parse(await json.text()) as { rows: { task: string }[] }
  expect(parsed.rows.map(row => row.task)).toEqual(['alpha'])
})

// Requirement: A command serves the docket as a page
// Scenario: The listener answers the loopback interface at port 4567 by default
// GIVEN the command asked to serve with no port named
// WHEN the server stands
// THEN it listens on the loopback interface at the conventional port — the URL a person opens is localhost:4567
it('listens on the loopback at the conventional port by default', async () => {
  const served = await serveOver(FILES)

  expect(served.url).toBe('http://localhost:4567/')
  expect(served.host).toBe('127.0.0.1')
  expect(served.port).toBe(4567)
  expect((await request('/docket', 4567)).status).toBe(200)
})

// Requirement: A command serves the docket as a page
// Scenario: A port a caller names is the port served on
// GIVEN a free port the caller names
// WHEN the command is asked to serve on it
// THEN it answers there — a second instance can run beside a first
it('serves on the port a caller names', async () => {
  const port = await freePort()
  const served = await serveOver(FILES, { port })

  expect(served.url).toBe(`http://localhost:${port}/`)
  expect((await request('/docket', port)).status).toBe(200)
})

// Requirement: A command serves the docket as a page
// Scenario: Serving runs until stopped, and stopping releases the port
// GIVEN a served docket on a named port
// WHEN it is fetched, left standing, fetched again, and then stopped
// THEN it kept answering until stop was called, and the port refuses connections once it has — released for whoever needs it next
it('runs until stopped, and stopping releases the port', async () => {
  const port = await freePort()
  const served = await serveOver(FILES, { port })

  expect((await request('/docket', port)).status).toBe(200)
  await new Promise(resolve => setTimeout(resolve, 50))
  expect((await request('/docket', port)).status).toBe(200)

  await served.stop()
  await expect(request('/docket', port)).rejects.toThrow()
})
