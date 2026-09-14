import type { RaisedEntry } from './types.ts'

/**
 * The raised-relationships ledger: one line per event, appended, never edited — the same shape
 * as the review LEDGER, and for the same reason: two branches that both raise or rule merge as
 * the union of their lines instead of a conflict.
 */

export function formatRaised(entry: RaisedEntry): string {
  return JSON.stringify(entry)
}

export function readRaised(text: string): readonly RaisedEntry[] {
  const entries: RaisedEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const entry = parseRaised(line)
    // A damaged line is skipped rather than refused: unlike the review LEDGER this record backs
    // no gate, it only avoids asking a human twice — losing one line costs a repeat notification,
    // not a promise slipping through unjudged.
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

function parseRaised(line: string): RaisedEntry | undefined {
  const held = objectFrom(line)
  if (held === undefined) return undefined
  const key = held['key']
  const at = held['at']
  if (typeof key !== 'string' || typeof at !== 'string') return undefined
  if (held['kind'] === 'raised') return { kind: 'raised', key, at }
  if (held['kind'] === 'ruled' && typeof held['ruling'] === 'string') {
    return { kind: 'ruled', key, at, ruling: held['ruling'] }
  }
  return undefined
}

function objectFrom(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Requirement: The same finding is not raised to a human twice
 *
 * Every relationship ever put in front of a human — raised or already ruled makes no difference
 * here, since this guards "has a human already seen this," not "is it settled."
 */
export function alreadyRaised(entries: readonly RaisedEntry[]): ReadonlySet<string> {
  return new Set(entries.map(entry => entry.key))
}
