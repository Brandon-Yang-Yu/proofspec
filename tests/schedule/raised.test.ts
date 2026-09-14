// Capability: schedule

import { expect, it } from 'vitest'
import { alreadyRaised, formatRaised, readRaised } from '../../src/schedule/index.ts'
import type { RaisedEntry } from '../../src/schedule/index.ts'

// Requirement: The same finding is not raised to a human twice
// Scenario: A raised entry read back from the ledger is the same entry that was written
// GIVEN a raised entry formatted onto a ledger line
// WHEN that line is read back
// THEN it comes back identical to the entry that was written
it('reads back a raised entry the same as it was written', () => {
  const entry: RaisedEntry = { kind: 'raised', key: 'capability:cli:a,b', at: '2026-01-01T00:00:00.000Z' }

  const read = readRaised(`${formatRaised(entry)}\n`)

  expect(read).toEqual([entry])
})

// Requirement: The same finding is not raised to a human twice
// Scenario: A damaged ledger line is skipped rather than refused
// GIVEN a ledger holding one damaged line and one good line
// WHEN the ledger is read
// THEN only the good line comes back
it('skips a damaged ledger line rather than refusing the whole ledger', () => {
  const entry: RaisedEntry = { kind: 'raised', key: 'capability:cli:a,b', at: '2026-01-01T00:00:00.000Z' }

  const read = readRaised(`not json\n${formatRaised(entry)}\n`)

  expect(read).toEqual([entry])
})

// Requirement: The same finding is not raised to a human twice
// Scenario: A relationship already ruled on still counts as already raised
// GIVEN a ledger holding only a ruled entry for a relationship, no separate raised line
// WHEN a scheduling pass checks whether it has already been raised
// THEN that relationship counts as already raised
it('counts a ruled relationship as already raised', () => {
  const ruled: RaisedEntry = { kind: 'ruled', key: 'capability:cli:a,b', at: '2026-01-01T00:00:00.000Z', ruling: 'go ahead with a' }

  expect(alreadyRaised([ruled]).has('capability:cli:a,b')).toBe(true)
})

// Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably
// Scenario: A ruled entry read back from the ledger carries the exact text the human wrote
// GIVEN a ruled entry formatted onto a ledger line
// WHEN that line is read back
// THEN its ruling is exactly the text the human wrote, unchanged
it('reads back a ruled entry with the exact ruling text it was written with', () => {
  const entry: RaisedEntry = { kind: 'ruled', key: 'capability:cli:a,b', at: '2026-01-01T00:00:00.000Z', ruling: 'go ahead with a' }

  const read = readRaised(`${formatRaised(entry)}\n`)

  expect(read).toEqual([entry])
})
