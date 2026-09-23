import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The queue root's path in one spelling: resolved through the filesystem when the root
 * stands on disk, lexically when it does not (a proof's `/repo` stands nowhere). Two
 * spellings of one path — `/var/...` handed in by a caller, `/private/var/...` read back
 * from `process.cwd()` after a chdir — are one repo, and one repo derives one name, so
 * the digest hashes the canonical spelling, never the one it was handed.
 */
function canonicalQueueRoot(queueRoot: string): string {
  try {
    return realpathSync(queueRoot)
  } catch {
    return resolve(queueRoot)
  }
}

/**
 * The SHA-256 digest of a queue root's canonical absolute path, as hex — one digest
 * feeding the two per-repo defaults: the dedicated tmux server's name (`cli/session.ts`)
 * and the docket serve port (`cli/serve.ts`). Both exist so two checkouts of two repos on
 * one machine never collide, and both read this same digest deliberately differently — the
 * socket takes its first 8 hex digits, the port its whole numeric value modulo 1000 — so
 * the two defaults are separate facts with separate collision spaces rather than one rule
 * wearing two names.
 */
export function queueRootDigest(queueRoot: string): string {
  return createHash('sha256').update(canonicalQueueRoot(queueRoot)).digest('hex')
}
