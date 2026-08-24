import type { Judgement, LedgerRead, ReviewEntry, ReviewSubject } from './types.ts'

/**
 * The ledger: one review to a line, appended, never edited.
 *
 * Appending rather than rewriting is what lets two branches both review and merge as a union
 * — every line is a fact about a key, and a key is a digest, so the same line written twice
 * says the same thing. A correction is a later line rather than an edit, which is why the
 * judgement that stands for a key is the last one written.
 */

export function readLedger(text: string): LedgerRead {
  const entries: ReviewEntry[] = []
  for (const [index, line] of text.split('\n').entries()) {
    // A blank line is the ordinary shape of a file that ends in a newline, not a damaged one.
    if (line.trim() === '') continue
    const entry = parseEntry(line)
    // Refused rather than skipped: passing over a damaged record is how a promise gets
    // through the gate unjudged, which is the one thing the ledger exists to prevent. The
    // line is named because that is where the reader has to go — a merge left half-resolved
    // looks exactly like this.
    if (entry === undefined) return { ok: false, reason: `line ${index + 1} of the ledger is not a review` }
    entries.push(entry)
  }
  return { ok: true, entries }
}

/**
 * One review as the line the ledger keeps it on. The fields are written in the order a person
 * reads them in a diff — what it is about, what was concluded, what backs that, then who and
 * when — rather than in whatever order the object was built.
 */
export function formatEntry(entry: ReviewEntry): string {
  const backing = entry.verdict === 'ok' ? { cites: entry.cites } : { note: entry.note }
  return JSON.stringify({
    key: entry.key,
    capability: entry.capability,
    requirement: entry.requirement,
    scenario: entry.scenario,
    verdict: entry.verdict,
    ...backing,
    by: entry.by,
    at: entry.at,
  })
}

export function standingReviews(entries: readonly ReviewEntry[]): ReadonlyMap<string, ReviewEntry> {
  const standing = new Map<string, ReviewEntry>()
  // In order, each overwriting the last, so a second look at the same key is what stands.
  for (const entry of entries) standing.set(entry.key, entry)
  return standing
}

/** One line read back, or nothing when it is not a review — a miss, not a crash. */
function parseEntry(line: string): ReviewEntry | undefined {
  const held = objectFrom(line)
  if (held === undefined) return undefined
  const subject = subjectOf(held)
  const judgement = judgementOf(held)
  if (subject === undefined || judgement === undefined) return undefined
  return { ...subject, ...judgement }
}

function objectFrom(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

function subjectOf(held: Record<string, unknown>): ReviewSubject | undefined {
  const key = textAt(held, 'key')
  const capability = textAt(held, 'capability')
  const requirement = textAt(held, 'requirement')
  const scenario = textAt(held, 'scenario')
  const by = textAt(held, 'by')
  const at = textAt(held, 'at')
  if (key === undefined || capability === undefined || requirement === undefined) return undefined
  if (scenario === undefined || by === undefined || at === undefined) return undefined
  return { key, capability, requirement, scenario, by, at }
}

function judgementOf(held: Record<string, unknown>): Judgement | undefined {
  const verdict = textAt(held, 'verdict')
  if (verdict === 'ok') {
    // Absent is a pass on a removed proof, which has nothing to point at. Present but
    // unreadable is a damaged line, and those are told apart rather than both read as absent.
    if (held['cites'] === undefined) return { verdict, cites: undefined }
    const cites = citationOf(held['cites'])
    return cites === undefined ? undefined : { verdict, cites }
  }
  if (verdict !== 'gap' && verdict !== 'drift') return undefined
  const note = textAt(held, 'note')
  return note === undefined ? undefined : { verdict, note }
}

function citationOf(value: unknown): { line: number; source: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const held = value as Record<string, unknown>
  const line = held['line']
  const source = held['source']
  if (typeof line !== 'number' || typeof source !== 'string') return undefined
  return { line, source }
}

/** A field that has to be a non-empty string to mean anything. */
function textAt(held: Record<string, unknown>, field: string): string | undefined {
  const value = held[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}
