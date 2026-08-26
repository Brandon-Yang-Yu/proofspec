// Capability: review

import { expect, it } from 'vitest'
import { formatEntry, readLedger, standingReviews } from '../../src/review/index.ts'
import { entry } from './support.ts'

/** A ledger written the way it is kept: one review to a line. */
function ledgerOf(entries: readonly ReturnType<typeof entry>[]): string {
  return entries.map(one => `${formatEntry(one)}\n`).join('')
}

// Requirement: The LEDGER keeps one review to a line, and the last one stands
// Scenario: A review written to the LEDGER reads back as it was written
// GIVEN a pass and a reported problem, written to a LEDGER
// WHEN the LEDGER is read back
// THEN both come back as they went in, because the two halves are the only agreement holding
//      the record together — a format that wrote what the reader cannot parse would lose a
//      judgement without anyone noticing it had gone
it('reads back every review it wrote', () => {
  const written = [entry({ key: 'aaaa11112222' }), entry({ key: 'bbbb33334444', verdict: 'drift' })]

  expect(readLedger(ledgerOf(written))).toEqual({ ok: true, entries: written })
})

// Requirement: The LEDGER keeps one review to a line, and the last one stands
// Scenario: A later review of the same KEY supersedes the earlier one
// GIVEN a scenario passed, and then judged again as drifting after a second look
// WHEN the judgement that stands for it is asked for
// THEN it is the later one, because appending is the only way to correct a record that
//      several branches write to at once, and it is what makes merging two of them a union
it('lets a later review of the same key stand over the earlier one', () => {
  const first = entry({ key: 'aaaa11112222', verdict: 'ok' })
  const second = entry({ key: 'aaaa11112222', verdict: 'drift', by: 'a second reviewer' })

  expect(standingReviews([first, second]).get('aaaa11112222')).toEqual(second)
})

// Requirement: The LEDGER keeps one review to a line, and the last one stands
// Scenario: A line that is not a review is reported rather than skipped
// GIVEN a LEDGER whose second line is not a review at all
// WHEN it is read
// THEN it says which line it could not read rather than returning the rest, because passing
//      over a damaged record is how a PROMISE gets through the gate unjudged — the one thing
//      the LEDGER exists to prevent
it('refuses a ledger holding a line it cannot read', () => {
  const damaged = [formatEntry(entry({ key: 'aaaa11112222' })), '<<<<<<< HEAD', ''].join('\n')

  expect(readLedger(damaged)).toEqual({ ok: false, reason: expect.stringContaining('line 2') })
})

// Requirement: The LEDGER keeps one review to a line, and the last one stands
// Scenario: A LEDGER with no lines holds no reviews
// GIVEN a repository where nothing has been reviewed yet, so the LEDGER is empty
// WHEN it is read
// THEN it holds no reviews rather than failing, because every branch starts here and an
//      absent record is the ordinary case, not a damaged one
it('reads an empty ledger as holding nothing', () => {
  expect(readLedger('')).toEqual({ ok: true, entries: [] })
  expect(readLedger('\n\n')).toEqual({ ok: true, entries: [] })
})
