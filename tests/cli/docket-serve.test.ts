// Capability: cli

import { createHash } from 'node:crypto'
import { realpathSync, symlinkSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { rm } from 'node:fs/promises'
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

/** A port this test holds open until `release` is called — the collision a serve must
 *  refuse, held by a listener the serve did not make. */
async function holdPort(): Promise<{ readonly port: number; release(): Promise<void> }> {
  const holder = createNetServer()
  const port = await new Promise<number>((resolve, reject) => {
    holder.once('error', reject)
    holder.listen(0, '127.0.0.1', () => resolve((holder.address() as AddressInfo).port))
  })
  return {
    port,
    release: () => new Promise(resolve => holder.close(() => resolve())),
  }
}

// The port the docket serves on when the caller names none: 4567 plus the queue root's
// SHA-256 digest taken as a number, modulo 1000. Computed here from the rule so a proof
// pins that the port follows the path, never a literal the implementation could share by
// accident — over the root's canonical spelling, the one path one repo derives its
// defaults from however it was handed in.
function derivedPort(queueRoot: string): number {
  const canonical = (() => {
    try {
      return realpathSync(queueRoot)
    } catch {
      return resolve(queueRoot)
    }
  })()
  const hex = createHash('sha256').update(canonical).digest('hex')
  return 4567 + Number(BigInt(`0x${hex}`) % 1000n)
}

/** Serves the docket over a fixture queue, on the port named (or the default when none
 *  is), at the root named (a fresh fixture's when none is). Answers with the server and
 *  the root served from, because the default port is derived from that root and a proof
 *  computes its expectation from the real path. */
async function serveOver(files: Readonly<Record<string, string>>, options: { readonly port?: number; readonly host?: string; readonly root?: string } = {}) {
  const repo = await makeRepo(files)
  const cwd = options.root ?? repo.root
  const served = await serveDocket({ cwd, port: options.port, host: options.host, docket: { listSessions: async () => [] } })
  if (!served.ok) throw new Error(`serving did not start: ${served.reason}`)
  standing.push(served)
  return { ...served, root: cwd }
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
// Scenario: The listener answers the loopback interface on the port derived from the queue root by default
// GIVEN the command asked to serve with no port named, over a queue whose root's absolute path is known — and that root spelled three ways: as it stands, through a whole-path symlink, and through a mid-path symlink on the route to it
// WHEN the server stands
// THEN it listens on the loopback interface at the port derived from that path — 4567 plus the numeric value of the path's SHA-256 digest taken modulo 1000, a number from 4567 through 5566 — the same port the same queue root derives on every run, however that root is spelled
it('listens on the loopback at the port derived from the queue root by default', async () => {
  const served = await serveOver(FILES)
  const port = derivedPort(served.root)

  expect(served.url).toBe(`http://localhost:${port}/`)
  expect(served.host).toBe('127.0.0.1')
  expect(served.port).toBe(port)
  expect((await request('/docket', port)).status).toBe(200)
  await served.stop()

  // One path, one port — however the path is spelled. A whole-path symlinked alias of
  // the root and a mid-path symlink on the route to it each name the same queue, and the
  // same queue derives the same port: a derivation hashing the spelling as handed, or
  // resolving symlinks only when the handed path is itself one, moves the port with the
  // spelling and fails here, on any machine, with no reliance on the machine's own
  // symlinked tmpdir.
  const alias = join(served.root, '..', 'alias-of-same-queue')
  await symlinkSync(served.root, alias)
  const parent = dirname(served.root)
  const midParent = join(parent, '..', 'midparent-of-same-queue')
  await symlinkSync(parent, midParent)
  const midPath = join(midParent, basename(served.root))
  try {
    const aliased = await serveOver(FILES, { root: alias })
    try {
      expect(aliased.port).toBe(port)
    } finally {
      await aliased.stop()
    }
    // One at a time: both spellings derive the same port, so the second can only stand
    // once the first has given the port back.
    const midway = await serveOver(FILES, { root: midPath })
    try {
      expect(midway.port).toBe(port)
    } finally {
      await midway.stop()
    }
  } finally {
    await rm(alias, { force: true })
    await rm(midParent, { force: true })
  }
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

// Requirement: A command serves the docket as a page
// Scenario: A port already taken fails the serve fast, naming the port it could not get and --port as the override
// GIVEN the port a serve wants is already held by another listener
// WHEN the command is asked to serve wanting that port
// THEN it fails outright — naming the port it could not get, and naming --port as the override — and never falls back to another port on its own
it('fails the serve outright when the port is already taken, naming the port and --port', async () => {
  const held = await holdPort()
  const repo = await makeRepo(FILES)

  const refused = await serveDocket({ cwd: repo.root, port: held.port, docket: { listSessions: async () => [] } })
  if (refused.ok) throw new Error('serving started on a port another listener already holds')
  expect(refused.reason).toContain(String(held.port))
  expect(refused.reason).toContain('--port')

  // No server left standing: once the holder lets go, the port refuses connections — the
  // refused serve left nothing on it, and the refusal itself says it took no other.
  await held.release()
  await expect(request('/docket', held.port)).rejects.toThrow()
})
