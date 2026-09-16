// Capability: handoff

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { manifestFrom, runEnqueueTask } from '../../src/handoff/extension.ts'
import type { EnqueueTaskInput } from '../../src/handoff/extension.ts'
import { cleanupRepos, makeGitRepo, makeRepo } from '../cli/support.ts'
import type { ScheduleActions } from '../../src/schedule/index.ts'

afterEach(cleanupRepos)

const VALID_INPUT: EnqueueTaskInput = { task: 'a-real-task', intentRef: 'docs/x.md', branch: 'work/a-real-task' }

async function queueDirExists(root: string): Promise<boolean> {
  try {
    await access(join(root, '.proofspec'))
    return true
  } catch {
    return false
  }
}

async function stateOf(root: string, task: string): Promise<string> {
  return readFile(join(root, '.proofspec', 'dispatch', task, 'state'), 'utf8')
}

async function manifestOf(root: string, task: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, '.proofspec', 'dispatch', task, 'MANIFEST'), 'utf8'))
}

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name containing a slash is refused before anything is written
// GIVEN a TASK name containing a slash
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name containing a slash before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: 'foo/bar' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name containing .. is refused before anything is written
// GIVEN a TASK name containing ..
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name containing .. before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: '../etc' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name containing a space is refused before anything is written
// GIVEN a TASK name containing a space
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name containing a space before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: 'a real task' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name containing an uppercase letter is refused before anything is written
// GIVEN a TASK name containing an uppercase letter
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name containing an uppercase letter before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: 'A-real-task' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name starting with a digit is refused before anything is written
// GIVEN a TASK name starting with a digit
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name starting with a digit before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: '1-real-task' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A TASK name ending with a hyphen is refused before anything is written
// GIVEN a TASK name ending with a hyphen
// WHEN enqueue_task is called with it
// THEN it refuses, and no .proofspec directory is ever created
it('refuses a TASK name ending with a hyphen before anything is written', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, { ...VALID_INPUT, task: 'a-real-task-' })

  expect(result.ok).toBe(false)
  expect(await queueDirExists(repo.root)).toBe(false)
})

// Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched
// Scenario: A plain kebab-case slug is accepted and passed through to enqueue
// GIVEN a TASK name that is a plain kebab-case slug
// WHEN enqueue_task is called with it
// THEN it succeeds and a queue entry now exists for that TASK
it('accepts a plain kebab-case slug and passes it through to enqueue', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, VALID_INPUT, {})

  expect(result).toMatchObject({ ok: true, task: 'a-real-task' })
  expect(await stateOf(repo.root, 'a-real-task')).toBe('queued')
})

// Requirement: A successful enqueue immediately triggers a scheduling pass
// Scenario: A successful enqueue immediately triggers a scheduling pass
// GIVEN a TASK not already in the queue, ready to dispatch as soon as it is queued
// WHEN enqueue_task is called
// THEN the scheduling pass it triggers dispatches that TASK before enqueue_task returns
it('triggers a scheduling pass that dispatches the TASK it just queued', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await repo.git(['branch', 'work/a-real-task'])
  const started: string[] = []
  const actions: ScheduleActions = { startSession: async task => { started.push(task) } }

  const result = await runEnqueueTask(repo.root, VALID_INPUT, actions)

  expect(result.ok).toBe(true)
  expect(started).toEqual(['a-real-task'])
})

// Requirement: A successful enqueue immediately triggers a scheduling pass
// Scenario: A refusal to enqueue never triggers a scheduling pass
// GIVEN a TASK name already in the queue
// WHEN enqueue_task is called again for it
// THEN no scheduling pass runs at all
it('never runs a scheduling pass when the enqueue itself is refused', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await repo.git(['branch', 'work/a-real-task'])
  await runEnqueueTask(repo.root, VALID_INPUT, {})
  const refusing: ScheduleActions = {
    startSession: async () => { throw new Error('a refused enqueue must never reach a scheduling pass') },
    judge: async () => { throw new Error('a refused enqueue must never reach a scheduling pass') },
    notifyHuman: async () => { throw new Error('a refused enqueue must never reach a scheduling pass') },
  }

  const result = await runEnqueueTask(repo.root, VALID_INPUT, refusing)

  expect(result.ok).toBe(false)
})

// Requirement: A successful enqueue immediately triggers a scheduling pass
// Scenario: A TASK stays reported as queued even when the pass that followed it could not run
// GIVEN a successful enqueue whose triggered pass cannot run (no startSession/judge action wired)
// WHEN enqueue_task answers
// THEN the TASK is still reported as queued, alongside the pass's own cannot-run outcome
it('still reports the TASK as queued even when its triggered pass could not run', async () => {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await repo.git(['branch', 'work/a-real-task'])

  const result = await runEnqueueTask(repo.root, VALID_INPUT, {})

  expect(result).toMatchObject({ ok: true, task: 'a-real-task' })
  expect(result.ok && result.scheduled.kind).toBe('cannot-run')
  expect(await stateOf(repo.root, 'a-real-task')).toBe('queued')
})

// Requirement: enqueue_task flattens its input onto the exact Manifest shape readManifest parses
// Scenario: A call with no base maps to a MANIFEST whose base is {kind: 'main'}
// GIVEN input with no base
// WHEN manifestFrom maps it
// THEN the resulting Manifest's base is {kind: 'main'}
it('maps a call with no base onto a MANIFEST whose base is {kind: main}', () => {
  const manifest = manifestFrom(VALID_INPUT)

  expect(manifest).toEqual({ intentRef: 'docs/x.md', branch: 'work/a-real-task', base: { kind: 'main' } })
})

// Requirement: enqueue_task flattens its input onto the exact Manifest shape readManifest parses
// Scenario: A call with a base naming another TASK and a reason maps to a MANIFEST whose base is exactly {kind: 'task', task, reason}
// GIVEN input with a base naming another TASK and a reason
// WHEN manifestFrom maps it
// THEN the resulting Manifest's base is exactly {kind: 'task', task, reason}
it('maps a call with a base onto a MANIFEST whose base names that TASK and reason exactly', () => {
  const input: EnqueueTaskInput = { ...VALID_INPUT, base: { task: 'earlier-task', reason: 'built on its branch' } }

  const manifest = manifestFrom(input)

  expect(manifest).toEqual({
    intentRef: 'docs/x.md',
    branch: 'work/a-real-task',
    base: { kind: 'task', task: 'earlier-task', reason: 'built on its branch' },
  })
})

// Requirement: enqueue_task answers enqueue()'s own result faithfully, without throwing
// Scenario: A TASK not already in the queue is enqueued with base {kind: 'main'} and state queued
// GIVEN a TASK name not already in the queue, with no base given
// WHEN enqueue_task is called
// THEN a queue entry now exists for it with base {kind: 'main'} and state queued
it('enqueues a fresh TASK with base {kind: main} and state queued', async () => {
  const repo = await makeRepo({})

  const result = await runEnqueueTask(repo.root, VALID_INPUT, {})

  expect(result).toMatchObject({ ok: true, task: 'a-real-task' })
  expect(await manifestOf(repo.root, 'a-real-task')).toEqual({
    intentRef: 'docs/x.md',
    branch: 'work/a-real-task',
    base: { kind: 'main' },
  })
  expect(await stateOf(repo.root, 'a-real-task')).toBe('queued')
})

// Requirement: enqueue_task answers enqueue()'s own result faithfully, without throwing
// Scenario: A TASK not already in the queue is enqueued with the given base recorded exactly
// GIVEN a TASK name not already in the queue, with a base naming another TASK and a reason
// WHEN enqueue_task is called
// THEN the queue entry's MANIFEST records that base exactly
it('enqueues a fresh TASK with its given base recorded exactly', async () => {
  const repo = await makeRepo({})
  const input: EnqueueTaskInput = { ...VALID_INPUT, base: { task: 'earlier-task', reason: 'built on its branch' } }

  const result = await runEnqueueTask(repo.root, input, {})

  expect(result).toMatchObject({ ok: true, task: 'a-real-task' })
  expect(await manifestOf(repo.root, 'a-real-task')).toEqual({
    intentRef: 'docs/x.md',
    branch: 'work/a-real-task',
    base: { kind: 'task', task: 'earlier-task', reason: 'built on its branch' },
  })
})

// Requirement: enqueue_task answers enqueue()'s own result faithfully, without throwing
// Scenario: A TASK already in the queue is refused, naming the collision, and its existing entry is untouched
// GIVEN a TASK name already in the queue
// WHEN enqueue_task is called again for it
// THEN it refuses, naming the collision, and the existing entry is unchanged
it('refuses a TASK name already in the queue, leaving its entry untouched', async () => {
  const repo = await makeRepo({})
  await runEnqueueTask(repo.root, VALID_INPUT, {})
  const attempted: EnqueueTaskInput = { ...VALID_INPUT, intentRef: 'docs/y.md', branch: 'work/a-real-task-2' }

  const result = await runEnqueueTask(repo.root, attempted, {})

  expect(result).toEqual({ ok: false, reason: expect.stringContaining('a-real-task') })
  expect(await manifestOf(repo.root, 'a-real-task')).toEqual({
    intentRef: 'docs/x.md',
    branch: 'work/a-real-task',
    base: { kind: 'main' },
  })
  expect(await stateOf(repo.root, 'a-real-task')).toBe('queued')
})
