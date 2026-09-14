import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareStrings } from '../order.ts'

/**
 * The conventional queue directory: one task per subdirectory, each holding a MANIFEST and a
 * state file. This reads them as strings, one task at a time, so one unreadable task never
 * stops the rest — `dispatch` decides what the bytes mean; this only fetches them.
 */

const QUEUE_DIR = ['.proofspec', 'dispatch'] as const
const MANIFEST_FILE = 'MANIFEST'
const STATE_FILE = 'state'

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
