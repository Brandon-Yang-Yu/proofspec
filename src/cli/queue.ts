import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readManifest, stateOf } from '../inflight/index.ts'
import type { Manifest, TaskFailure, TaskRecord } from '../inflight/index.ts'
import { compareStrings } from '../order.ts'

/**
 * The conventional queue directory: one task per subdirectory, each holding a MANIFEST and a
 * state file. This reads them as strings, one task at a time, so one unreadable task never
 * stops the rest — `inflight` decides what the bytes mean; this only fetches them.
 *
 * `schedule` is the one capability with permission to write here — pruning a merged entry and
 * taking a LEASE on a ready one — so the write-side helpers live beside the read-side ones that
 * already own this directory's shape, rather than a second module holding its own copy of it.
 */

const QUEUE_DIR = ['.proofspec', 'dispatch'] as const
const MANIFEST_FILE = 'MANIFEST'
const STATE_FILE = 'state'
const LEASE_FILE = 'LEASE'
const HEARTBEAT_FILE = 'heartbeat'

/** One task's MANIFEST and state as read, or the reason that task alone could not be read. */
export type QueueEntry =
  | { readonly ok: true; readonly task: string; readonly manifest: string; readonly state: string }
  | { readonly ok: false; readonly task: string; readonly reason: string }

/** The queue as a whole, or the reason the directory itself could not be listed. */
export type QueueRead =
  | { readonly ok: true; readonly tasks: readonly QueueEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Every task in the conventional queue directory. A directory that does not exist at all holds
 * no task in flight — the ordinary state between rounds — and answers an empty list; one that
 * exists but cannot be listed (permissions, a file sitting where a directory belongs) is
 * refused instead, because no task's absence explains that.
 */
export async function readQueue(cwd: string): Promise<QueueRead> {
  const dir = join(cwd, ...QUEUE_DIR)
  const names = await listTaskDirs(dir)
  if (names === undefined) return { ok: false, reason: `${dir} could not be read` }
  const tasks = await Promise.all(names.sort(compareStrings).map(task => readTask(dir, task)))
  return { ok: true, tasks }
}

/** Task subdirectory names, `[]` when the queue directory is simply absent, `undefined` when it cannot be listed. */
async function listTaskDirs(dir: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return undefined
  }
}

async function readTask(dir: string, task: string): Promise<QueueEntry> {
  const taskDir = join(dir, task)
  const manifestPath = join(taskDir, MANIFEST_FILE)
  const manifest = await readOptional(manifestPath)
  if (manifest === undefined) return { ok: false, task, reason: `task ${task} has no ${MANIFEST_FILE} at ${manifestPath}` }
  const statePath = join(taskDir, STATE_FILE)
  const state = await readOptional(statePath)
  if (state === undefined) return { ok: false, task, reason: `task ${task} has no ${STATE_FILE} at ${statePath}` }
  return { ok: true, task, manifest, state }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Turns the queue's raw per-task strings into typed records, splitting one unreadable or
 * unparsable TASK into its own failure rather than stopping the rest — the same per-task
 * resilience `readQueue` itself already keeps one level down. Shared by every reader that
 * needs the queue as `TaskRecord` rather than raw text: `inflight`'s own graph and the
 * queue-aware census alike.
 *
 * `words` carries a TASK's raw state word alongside its record, for a caller (`schedule`)
 * that dispatches on the literal word rather than the collapsed `TaskState` — populated only
 * for a TASK that also produced a record, so a TASK whose MANIFEST cannot be read is never
 * dispatchable on its state word alone.
 */
export function recordsFrom(tasks: readonly QueueEntry[]): {
  readonly records: readonly TaskRecord[]
  readonly failures: readonly TaskFailure[]
  readonly words: ReadonlyMap<string, string>
} {
  const failures: TaskFailure[] = []
  const records: TaskRecord[] = []
  const words = new Map<string, string>()
  for (const entry of tasks) {
    if (!entry.ok) {
      failures.push({ task: entry.task, reason: entry.reason })
      continue
    }
    const manifest = readManifest(entry.manifest)
    if (!manifest.ok) {
      failures.push({ task: entry.task, reason: manifest.reason })
      continue
    }
    words.set(entry.task, entry.state)
    records.push({ task: entry.task, manifest: manifest.manifest, state: stateOf(entry.state) })
  }
  return { records, failures, words }
}

/** A TASK's own MANIFEST, parsed — or nothing when its queue entry has none, or the one it has
 * does not read. `session` needs a TASK's `branch` before it can start anything for it. */
export async function manifestFor(cwd: string, task: string): Promise<Manifest | undefined> {
  const raw = await readOptional(join(cwd, ...QUEUE_DIR, task, MANIFEST_FILE))
  if (raw === undefined) return undefined
  const parsed = readManifest(raw)
  return parsed.ok ? parsed.manifest : undefined
}

/** A TASK's LEASE, as raw text (the instant it was taken), or nothing when it carries none. */
export async function readLease(cwd: string, task: string): Promise<string | undefined> {
  return readOptional(join(cwd, ...QUEUE_DIR, task, LEASE_FILE))
}

/**
 * Takes a LEASE by creating its file exclusively — `wx` fails with `EEXIST` rather than
 * overwriting, which is what makes the take itself the single atomic step two scheduling
 * passes race on. Deciding a LEASE is missing or stale and then writing it in two separate
 * steps would leave a window between them for another pass to decide the very same thing;
 * this collapses that window to the one filesystem call the OS already makes atomic.
 * Answers whether this call is the one that won.
 */
export async function takeLease(cwd: string, task: string, takenAt: string): Promise<boolean> {
  const dir = join(cwd, ...QUEUE_DIR, task)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, LEASE_FILE), takenAt, { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

const RECLAIM_LOCK = 'LEASE.reclaiming'

/**
 * Reclaims a LEASE observed as stale, holding exactly the instant it was read as `staleAt` —
 * clearing and re-taking it as one step no second pass can land inside of, and only when the
 * LEASE still holds that exact value.
 *
 * A lock directory alone is not enough: two passes can each read the same stale LEASE, and by
 * the time the second reaches this call the first may already have cleared and retaken it — a
 * lock only stops them from clearing it *at the same time*, not from one of them clearing a
 * LEASE that is no longer the stale one either of them saw. Re-reading the LEASE once inside the
 * lock and refusing unless it still equals `staleAt` is what actually closes that gap: a pass
 * that loses the race sees a LEASE some other value now, answers `false`, and is blocked the
 * same way a losing `takeLease` call is.
 */
export async function reclaimLease(cwd: string, task: string, staleAt: string, takenAt: string): Promise<boolean> {
  const dir = join(cwd, ...QUEUE_DIR, task)
  const lock = join(dir, RECLAIM_LOCK)
  try {
    await mkdir(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  try {
    const current = await readOptional(join(dir, LEASE_FILE))
    if (current !== staleAt) return false
    await rm(join(dir, LEASE_FILE), { force: true })
    return await takeLease(cwd, task, takenAt)
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

/** When a TASK's `state` and `heartbeat` files were last written, read from the filesystem's
 * own record of each write — the two ages the docket answers, tracked nowhere else. The
 * heartbeat may legitimately be absent (a TASK with no session), so its time is optional; a
 * `state` file that cannot be statted makes the whole read fail, because a TASK whose word
 * cannot be aged is a problem for that TASK alone rather than a row with a number invented
 * for it. */
export type WriteTimes = {
  readonly stateWrittenAt: number
  readonly heartbeatWrittenAt: number | undefined
}

/** The write times of a TASK's `state` and `heartbeat` files, or nothing when the `state`
 * file itself cannot be read. */
export async function writeTimes(cwd: string, task: string): Promise<WriteTimes | undefined> {
  const stateWrittenAt = await mtimeOf(join(cwd, ...QUEUE_DIR, task, STATE_FILE))
  if (stateWrittenAt === undefined) return undefined
  return { stateWrittenAt, heartbeatWrittenAt: await mtimeOf(join(cwd, ...QUEUE_DIR, task, HEARTBEAT_FILE)) }
}

/** A file's write time, or nothing when it cannot be read — a miss, not a crash. */
async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return undefined
  }
}

/** Removes a TASK's whole queue entry — the prune this capability alone is permitted to make. */
export async function removeQueueEntry(cwd: string, task: string): Promise<void> {
  await rm(join(cwd, ...QUEUE_DIR, task), { recursive: true, force: true })
}

/** Overwrites a TASK's state with a new word. No knowledge of which words exist or what order
 * they follow — a caller choosing a word already has to know that; validating a transition
 * (only `building` may become `merged`, say) belongs to whichever specific caller writes that
 * rule, not to this primitive. */
export async function writeState(cwd: string, task: string, word: string): Promise<void> {
  await writeFile(join(cwd, ...QUEUE_DIR, task, STATE_FILE), word)
}

/** Whether `enqueue` created a new entry, or refused because one already stood. */
export type EnqueueResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Creates a new queue entry for a TASK not seen before: its MANIFEST, and an initial state of
 * `queued`. Refuses, touching nothing, when a TASK of that name is already in the queue — the
 * same `wx`-flag idiom `takeLease` above already uses, so the check-then-create step two
 * callers racing to enqueue the same name could otherwise land inside of is collapsed to the
 * one filesystem call the OS already makes atomic.
 */
export async function enqueue(cwd: string, task: string, manifest: Manifest): Promise<EnqueueResult> {
  const dir = join(cwd, ...QUEUE_DIR, task)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest), { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, reason: `a TASK named ${task} is already in the queue` }
    throw error
  }
  await writeState(cwd, task, 'queued')
  return { ok: true }
}
