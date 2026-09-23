import { createHash } from 'node:crypto'

/**
 * The SHA-256 digest of a queue root's absolute path, as hex — one digest feeding the two
 * per-repo defaults: the dedicated tmux server's name (`cli/session.ts`) and the docket
 * serve port (`cli/serve.ts`). Both exist so two checkouts of two repos on one machine
 * never collide, and both read this same digest deliberately differently — the socket takes
 * its first 8 hex digits, the port its whole numeric value modulo 1000 — so the two defaults
 * are separate facts with separate collision spaces rather than one rule wearing two names.
 */
export function queueRootDigest(queueRoot: string): string {
  return createHash('sha256').update(queueRoot).digest('hex')
}
