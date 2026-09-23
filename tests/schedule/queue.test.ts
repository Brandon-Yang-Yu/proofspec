// Capability: schedule

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { enqueue, writeState } from '../../src/cli/queue.ts'
import type { Manifest } from '../../src/inflight/index.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

/** Writes one task subdirectory under the conventional queue path, the same shape
 *  `tests/cli/queue.test.ts` writes fixtures with. */
async function writeTask(root: string, task: string, files: { readonly manifest?: string; readonly state?: string }): Promise<void> {
  const dir = join(root, '.proofspec', 'dispatch', task)
  await mkdir(dir, { recursive: true })
  if (files.manifest !== undefined) await writeFile(join(dir, 'MANIFEST'), files.manifest)
  if (files.state !== undefined) await writeFile(join(dir, 'state'), files.state)
}

async function stateOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'state'), 'utf8')
}

async function manifestOf(root: string, task: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, '.proofspec', 'dispatch', task, 'MANIFEST'), 'utf8'))
}

/** An archived entry as the prune leaves one: the TASK's whole entry standing in
 *  `.proofspec/archive/<task>/`, its files exactly as they stood. */
async function writeArchived(root: string, task: string, files: { readonly manifest?: string; readonly state?: string }): Promise<void> {
  const dir = join(root, '.proofspec', 'archive', task)
  await mkdir(dir, { recursive: true })
  if (files.manifest !== undefined) await writeFile(join(dir, 'MANIFEST'), files.manifest)
  if (files.state !== undefined) await writeFile(join(dir, 'state'), files.state)
}

async function archivedManifestOf(root: string, task: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, '.proofspec', 'archive', task, 'MANIFEST'), 'utf8'))
}

// Requirement: writeState overwrites a TASK's state file with exactly the word it is given
// Scenario: writeState overwrites an existing state file with the word it is given, whatever it is
// GIVEN a TASK whose state file already holds a word
// WHEN writeState is called with a different, arbitrary word
// THEN the state file holds exactly that new word
it('overwrites a state file with exactly the word given, whatever it is', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{}', state: 'building' })

  await writeState(repo.root, 'a', 'not-a-recognized-word')

  expect(await stateOf(repo.root, 'a')).toBe('not-a-recognized-word')
})

const MANIFEST: Manifest = { intentRef: 'docs/x.md', branch: 'work/a' }

// Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there
// Scenario: enqueue creates a new TASK's MANIFEST and initial queued state
// GIVEN no queue entry exists yet for a TASK name
// WHEN enqueue is called with that TASK's manifest
// THEN a new queue entry exists holding that MANIFEST and a state of queued
it('creates a new queue entry with its MANIFEST and an initial queued state', async () => {
  const repo = await makeRepo({})

  const result = await enqueue(repo.root, 'a', MANIFEST)

  expect(result).toEqual({ ok: true })
  expect(await manifestOf(repo.root, 'a')).toEqual(MANIFEST)
  expect(await stateOf(repo.root, 'a')).toBe('queued')
})

// Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there
// Scenario: enqueue refuses a TASK name already in the queue, without touching its existing entry
// GIVEN a queue entry already exists for a TASK name
// WHEN enqueue is called again with that same TASK name
// THEN it answers ok:false naming the collision, and the existing MANIFEST/state are unchanged
it('refuses a TASK name already in the queue, leaving its entry untouched', async () => {
  const repo = await makeRepo({})
  await enqueue(repo.root, 'a', MANIFEST)
  await writeState(repo.root, 'a', 'building')
  const attempted: Manifest = { intentRef: 'docs/y.md', branch: 'work/a-2' }

  const result = await enqueue(repo.root, 'a', attempted)

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('a') })
  expect(await manifestOf(repo.root, 'a')).toEqual(MANIFEST)
  expect(await stateOf(repo.root, 'a')).toBe('building')
})

// Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there
// Scenario: A TASK name already standing in the archive is refused, naming the archive
// GIVEN an archived entry already stands for a TASK name
// WHEN enqueue is called with that same TASK name
// THEN it refuses, naming the archive in its reason, and the archived entry is untouched with no queue entry created
it('refuses a TASK name already standing in the archive, leaving the archive untouched', async () => {
  const repo = await makeRepo({})
  await writeArchived(repo.root, 'a', { manifest: JSON.stringify(MANIFEST), state: 'merged' })
  const attempted: Manifest = { intentRef: 'docs/y.md', branch: 'work/a-2' }

  const result = await enqueue(repo.root, 'a', attempted)

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('archive') })
  expect(await archivedManifestOf(repo.root, 'a')).toEqual(MANIFEST)
  await expect(access(join(repo.root, '.proofspec', 'dispatch'))).rejects.toThrow()
})

// Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there
// Scenario: A TASK name no archived entry holds enqueues while the archive stands
// GIVEN an archive already holding one finished TASK, and a different TASK name not yet in the queue
// WHEN enqueue is called with that new name
// THEN it creates the new TASK's entry — the archive's presence alone refuses nothing, only a name it holds is spent
it('enqueues a fresh name while the archive stands, refusing nothing', async () => {
  const repo = await makeRepo({})
  await writeArchived(repo.root, 'old', { manifest: JSON.stringify(MANIFEST), state: 'merged' })

  const result = await enqueue(repo.root, 'new', { ...MANIFEST, branch: 'work/new' })

  expect(result).toEqual({ ok: true })
  expect(await stateOf(repo.root, 'new')).toBe('queued')
  expect(await archivedManifestOf(repo.root, 'old')).toEqual(MANIFEST)
})

// Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there
// Scenario: Two racing enqueue calls on the same TASK name still create exactly one entry
// GIVEN no queue entry exists yet for a TASK name
// WHEN two enqueue calls for that same name race at the same instant rather than one after another
// THEN exactly one succeeds and the other refuses, and the surviving entry is whichever one won, not a mix of both
it('creates exactly one entry when two enqueue calls race on the same TASK name', async () => {
  const repo = await makeRepo({})
  const manifestA: Manifest = { intentRef: 'docs/a.md', branch: 'work/a' }
  const manifestB: Manifest = { intentRef: 'docs/b.md', branch: 'work/b' }

  const [first, second] = await Promise.all([enqueue(repo.root, 'a', manifestA), enqueue(repo.root, 'a', manifestB)])

  const results = [first, second]
  expect(results.filter(result => result.ok)).toHaveLength(1)
  expect(results.filter(result => !result.ok)).toHaveLength(1)
  const winner = first.ok ? manifestA : manifestB
  expect(await manifestOf(repo.root, 'a')).toEqual(winner)
  expect(await stateOf(repo.root, 'a')).toBe('queued')
})
