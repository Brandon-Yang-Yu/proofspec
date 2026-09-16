// Capability: schedule

import { expect, it } from 'vitest'
import { leaseDecision, LEASE_GRACE_MS, readyToDispatch } from '../../src/schedule/index.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A ready TASK with no LEASE decides to take one
// GIVEN a ready TASK carrying no LEASE
// WHEN a scheduling pass decides whether to dispatch it
// THEN the decision is to take the LEASE
it('decides to take the LEASE when a ready TASK carries none', () => {
  const decision = leaseDecision({ existing: undefined, word: 'queued', now: NOW })

  expect(decision).toEqual({ kind: 'take' })
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A second pass finding an unexpired LEASE decides to block
// GIVEN a ready TASK a first pass already took the LEASE on, moments ago
// WHEN a second pass finds the same ready TASK before the grace period elapses
// THEN the decision is blocked
it('decides to block a second pass while an existing LEASE has not gone stale', () => {
  const takenAt = new Date(NOW.getTime() - 1_000).toISOString()

  const decision = leaseDecision({ existing: { takenAt }, word: 'queued', now: NOW })

  expect(decision).toEqual({ kind: 'blocked' })
})

// Requirement: A stale LEASE is told apart from a live one by elapsed time, not by probing a process
// Scenario: A LEASE outliving the grace period without the state advancing is reclaimed
// GIVEN a TASK whose LEASE was taken longer ago than the grace period, still carrying its
//       original state word
// WHEN a scheduling pass decides whether to dispatch it
// THEN the LEASE is treated as stale and taken again
it('reclaims a LEASE once the grace period has passed with no state advance', () => {
  const takenAt = new Date(NOW.getTime() - (LEASE_GRACE_MS + 1)).toISOString()

  const decision = leaseDecision({ existing: { takenAt }, word: 'queued', now: NOW })

  expect(decision).toEqual({ kind: 'take' })
})

// Requirement: A stale LEASE is told apart from a live one by elapsed time, not by probing a process
// Scenario: A LEASE whose TASK has advanced to building is never reclaimed by elapsed time alone
// GIVEN a TASK whose LEASE was taken longer ago than the grace period, but whose state has
//       already advanced to building
// WHEN a scheduling pass decides whether to dispatch it
// THEN the LEASE is still treated as live, blocking a second session
it('never reclaims a LEASE once the TASK has advanced to building, however long it has stood', () => {
  const justPastGrace = new Date(NOW.getTime() - (LEASE_GRACE_MS + 1)).toISOString()
  const daysPastGrace = new Date(NOW.getTime() - LEASE_GRACE_MS * 1_000).toISOString()

  expect(leaseDecision({ existing: { takenAt: justPastGrace }, word: 'building', now: NOW })).toEqual({ kind: 'blocked' })
  expect(leaseDecision({ existing: { takenAt: daysPastGrace }, word: 'building', now: NOW })).toEqual({ kind: 'blocked' })
})

// Requirement: A TASK held on another is released once the held-on TASK is no longer live
// Scenario: A held TASK is never ready to dispatch, however queued its own word is
// GIVEN a queued TASK that is held on another TASK
// WHEN a scheduling pass decides which TASK are ready
// THEN the held TASK is not among them
it('excludes a held TASK from readiness even while queued', () => {
  const ready = readyToDispatch([{ task: 'b', word: 'queued' }], new Set(['b']))

  expect(ready).toEqual([])
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A queued, unheld TASK is ready
// GIVEN a queued TASK that is not held on any other TASK
// WHEN a scheduling pass decides which TASK are ready
// THEN that TASK is ready
it('includes a queued, unheld TASK as ready', () => {
  const ready = readyToDispatch([{ task: 'a', word: 'queued' }], new Set())

  expect(ready).toEqual(['a'])
})

// Requirement: Dispatching a ready TASK starts exactly one executor session
// Scenario: A TASK already building is not ready to dispatch again
// GIVEN a TASK whose state word is building
// WHEN a scheduling pass decides which TASK are ready
// THEN that TASK is not ready
it('excludes a TASK already building from readiness', () => {
  const ready = readyToDispatch([{ task: 'a', word: 'building' }], new Set())

  expect(ready).toEqual([])
})
