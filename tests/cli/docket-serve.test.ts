// Capability: cli

import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
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
async function serveOver(files: Readonly<Record<string, string>>, options: { readonly port?: number; readonly host?: string } = {}) {
  const repo = await makeRepo(files)
  const served = await serveDocket({ cwd: repo.root, port: options.port, host: options.host, docket: { listSessions: async () => [] } })
  if (!served.ok) throw new Error(`serving did not start: ${served.reason}`)
  standing.push(served)
  return served
}

/** This machine's own non-loopback IPv4 address — an interface a caller could name. */
function ownAddress(): string {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  throw new Error('this machine has no non-loopback IPv4 address to name')
}

/** One request, as the page or a curl makes it. */
async function request(path: string, port: number): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`)
}

/** One request aimed at the interface named, instead of the loopback. */
async function askAt(host: string, port: number, path: string): Promise<Response> {
  return await fetch(`http://${host}:${port}${path}`)
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
// GIVEN a served docket standing on one port, and a second free port the caller names
// WHEN a second instance is asked to serve beside the first, on that port
// THEN both answer — each on the port it was given, standing beside the other
it('serves on the port a caller names, beside a first instance', async () => {
  const first = await serveOver(FILES, { port: await freePort() })
  const secondPort = await freePort()
  const second = await serveOver(FILES, { port: secondPort })

  expect(second.url).toBe(`http://localhost:${secondPort}/`)
  expect((await request('/docket', secondPort)).status).toBe(200)
  expect((await request('/docket', first.port)).status).toBe(200)
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

  // Released for whoever needs it next: a refusal alone could be a socket held and not
  // listening, so the proof is a next listener taking the port and answering on it.
  const next = await serveOver(FILES, { port })
  expect((await request('/docket', port)).status).toBe(200)
})

// Requirement: A command serves the docket as a page
// Scenario: The listener answers the loopback interface only
// GIVEN the command asked to serve with no host named
// WHEN the page is asked for at this machine's own non-loopback address
// THEN the connection is refused — the listener answers the loopback interface, never one the caller did not name
it('answers the loopback interface only, never one the caller did not name', async () => {
  const served = await serveOver(FILES, { port: await freePort() })

  await expect(askAt(ownAddress(), served.port, '/')).rejects.toThrow()
})

// Requirement: A command serves the docket as a page
// Scenario: A named --host is the interface served on
// GIVEN the command asked to serve, naming this machine's own address as the host on a free port
// WHEN the page and its JSON are asked for at that address
// THEN both answer — on the interface the caller named, not only the loopback
it('serves on the interface a caller names with --host', async () => {
  const host = ownAddress()
  const served = await serveOver(FILES, { port: await freePort(), host })

  const page = await askAt(host, served.port, '/')
  expect(page.status).toBe(200)
  expect(page.headers.get('content-type')).toContain('text/html')

  const json = await askAt(host, served.port, '/docket')
  expect(json.status).toBe(200)
  expect(json.headers.get('content-type')).toContain('application/json')
})
