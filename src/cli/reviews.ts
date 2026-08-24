import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { formatEntry, readLedger } from '../review/index.ts'
import type { LedgerRead, ReviewEntry } from '../review/index.ts'

/**
 * The review ledger on disk. `review` owns what a line means; this owns where the file is and
 * how it is added to, the way `discover` owns turning a directory into strings.
 *
 * It is committed rather than ignored, unlike the coverage recording beside it. A judgement is
 * something a person reads in a pull request — a page of bare passes with nothing cited is
 * visible there in a way no mechanical rule could make it — and CI cannot hold a gate against
 * a record that only ever existed on the reviewer's machine.
 */
export const LEDGER_PATH = '.proofspec/reviews.jsonl'

export async function readReviews(cwd: string): Promise<LedgerRead> {
  try {
    return readLedger(await readFile(resolve(cwd, LEDGER_PATH), 'utf8'))
  } catch {
    // No ledger yet is where every branch starts, and it is not the same as one that cannot be
    // parsed: that is `readLedger`'s answer to give, and it gives it as a cannot-run.
    return { ok: true, entries: [] }
  }
}

export async function appendReview(to: { readonly cwd: string; readonly entry: ReviewEntry }): Promise<void> {
  const path = resolve(to.cwd, LEDGER_PATH)
  await mkdir(dirname(path), { recursive: true })
  // Appended rather than rewritten, so a correction is a later line and two branches that both
  // reviewed merge as the union of their lines instead of as a conflict.
  await appendFile(path, `${formatEntry(to.entry)}\n`)
}
