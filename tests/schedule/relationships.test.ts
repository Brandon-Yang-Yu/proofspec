// Capability: schedule

import { expect, it } from 'vitest'
import type { Relationship } from '../../src/dispatch/index.ts'
import { relationshipKey, toRaise } from '../../src/schedule/index.ts'

function relationship(name: string, tasks: readonly string[]): Relationship {
  return { node: { kind: 'capability', name }, tasks }
}

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A relationship the fresh agent resolved is never raised
// GIVEN a relationship the fresh agent judged resolved
// WHEN a scheduling pass decides what to raise to a human
// THEN that relationship is not raised
it('never raises a relationship the fresh agent resolved', () => {
  const cli = relationship('cli', ['a', 'b'])

  const raise = toRaise({
    relationships: [cli],
    verdicts: new Map([[relationshipKey(cli), 'resolved']]),
    alreadyRaised: new Set(),
  })

  expect(raise).toEqual([])
})

// Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably
// Scenario: A relationship the fresh agent could not resolve, never raised before, is raised
// GIVEN a relationship the fresh agent judged unresolved, and no earlier pass has raised it
// WHEN a scheduling pass decides what to raise to a human
// THEN that relationship is raised
it('raises a relationship the fresh agent could not resolve', () => {
  const cli = relationship('cli', ['a', 'b'])

  const raise = toRaise({
    relationships: [cli],
    verdicts: new Map([[relationshipKey(cli), 'unresolved']]),
    alreadyRaised: new Set(),
  })

  expect(raise).toEqual([cli])
})

// Requirement: The same finding is not raised to a human twice
// Scenario: A relationship already raised is not raised again, however many passes recompute it
// GIVEN a relationship the fresh agent judged unresolved, already raised by an earlier pass
// WHEN a later scheduling pass recomputes the same graph
// THEN that relationship is not raised again
it('does not raise a relationship a prior pass already raised', () => {
  const cli = relationship('cli', ['a', 'b'])
  const key = relationshipKey(cli)

  const raise = toRaise({
    relationships: [cli],
    verdicts: new Map([[key, 'unresolved']]),
    alreadyRaised: new Set([key]),
  })

  expect(raise).toEqual([])
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A relationship's key names the same node and TASK regardless of the order they arrive in
// GIVEN two relationships over the same node and the same TASK, listed in different orders
// WHEN their keys are computed
// THEN the keys are identical
it('keys a relationship the same regardless of task order', () => {
  expect(relationshipKey(relationship('cli', ['b', 'a']))).toBe(relationshipKey(relationship('cli', ['a', 'b'])))
})
