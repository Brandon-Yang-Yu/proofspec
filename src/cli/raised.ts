import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { formatRaised, readRaised } from '../schedule/index.ts'
import type { RaisedEntry } from '../schedule/index.ts'

/**
 * The raised-relationships ledger on disk, the same shape `reviews.ts` gives the review LEDGER:
 * `schedule` owns what a line means, this owns where the file is and how it grows.
 *
 * Committed rather than ignored: whether a relationship has already reached a human, and what
 * the human ruled, are both facts a later reader — another branch, another session — needs to
 * see, the same reason a review is committed rather than kept on one machine.
 */
export const RAISED_LEDGER_PATH = '.proofspec/schedule/raised.jsonl'

export async function readRaisedLedger(cwd: string): Promise<readonly RaisedEntry[]> {
  try {
    return readRaised(await readFile(resolve(cwd, RAISED_LEDGER_PATH), 'utf8'))
  } catch {
    // No ledger yet is where every branch starts — nothing has been raised.
    return []
  }
}

export async function appendRaised(cwd: string, entry: RaisedEntry): Promise<void> {
  const path = resolve(cwd, RAISED_LEDGER_PATH)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${formatRaised(entry)}\n`)
}
