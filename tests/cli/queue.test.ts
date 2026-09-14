// Capability: cli

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readQueue } from '../../src/cli/queue.ts'
import { cleanupRepos, makeRepo } from './support.ts'

afterEach(cleanupRepos)

/** Writes one task subdirectory under the conventional queue path. */
async function writeTask(root: string, task: string, files: { readonly manifest?: string; readonly state?: string }): Promise<void> {
  const dir = join(root, '.proofspec', 'dispatch', task)
  await mkdir(dir, { recursive: true })
  if (files.manifest !== undefined) await writeFile(join(dir, 'MANIFEST'), files.manifest)
  if (files.state !== undefined) await writeFile(join(dir, 'state'), files.state)
}

// Requirement: A conventional queue directory is read one task at a time
// Scenario: A queue directory is read into one entry per task subdirectory
// GIVEN a queue directory holding two task subdirectories, each with a MANIFEST and a state file
// WHEN the queue directory is read
// THEN each task comes back with the bytes of its own MANIFEST and state file
it('reads a queue directory into one entry per task subdirectory', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'a', { manifest: '{"a":1}', state: 'building' })
  await writeTask(repo.root, 'b', { manifest: '{"b":2}', state: 'queued' })

  const result = await readQueue(repo.root)

  expect(result).toEqual({
    ok: true,
    tasks: [
      { ok: true, task: 'a', manifest: '{"a":1}', state: 'building' },
      { ok: true, task: 'b', manifest: '{"b":2}', state: 'queued' },
    ],
  })
})

// Requirement: A conventional queue directory is read one task at a time
// Scenario: One unreadable task answers a problem for that task alone, the rest still read
// GIVEN a queue directory holding one task with no MANIFEST and one ordinary task
// WHEN the queue directory is read
// THEN the incomplete task answers a problem naming itself and the ordinary task still reads
it('answers a problem for one unreadable task, and still reads the rest', async () => {
  const repo = await makeRepo({})
  await writeTask(repo.root, 'broken', { state: 'queued' })
  await writeTask(repo.root, 'fine', { manifest: '{}', state: 'queued' })

  const result = await readQueue(repo.root)

  expect(result.ok).toBe(true)
  const tasks = result.ok ? result.tasks : []
  expect(tasks.find(one => one.task === 'fine')).toEqual({ ok: true, task: 'fine', manifest: '{}', state: 'queued' })
  const broken = tasks.find(one => one.task === 'broken')
  if (broken === undefined || broken.ok) throw new Error('expected task "broken" to answer a problem')
  expect(broken.reason).toContain('broken')
})

// Requirement: A conventional queue directory is read one task at a time
// Scenario: A queue directory that exists but cannot be listed is a refusal naming the path
// GIVEN a plain file sitting where the queue directory is conventionally found
// WHEN the queue directory is read
// THEN the answer is a refusal naming that path
it('refuses a queue directory that exists but cannot be listed, naming the path', async () => {
  const repo = await makeRepo({})
  await mkdir(join(repo.root, '.proofspec'), { recursive: true })
  const blocked = join(repo.root, '.proofspec', 'dispatch')
  await writeFile(blocked, 'not a directory')

  const result = await readQueue(repo.root)

  expect(result).toEqual({ ok: false, reason: expect.stringContaining(blocked) })
})

// Requirement: A conventional queue directory is read one task at a time
// Scenario: A queue directory that does not exist answers an empty list of tasks
// GIVEN a repository with no .proofspec/dispatch directory at all
// WHEN the queue directory is read
// THEN the answer holds no tasks, and is not a refusal
it('answers an empty list of tasks when the queue directory does not exist', async () => {
  const repo = await makeRepo({})

  const result = await readQueue(repo.root)

  expect(result).toEqual({ ok: true, tasks: [] })
})
