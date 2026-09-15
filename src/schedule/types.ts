import type { Relationship } from '../inflight/index.ts'

/**
 * The literal state word every other command reads. `inflight` collapses this to
 * merged/in-flight because that is all a graph needs; a LEASE has to tell `building` apart
 * from every other in-flight word, so schedule keeps the word itself.
 */
export const BUILDING = 'building'

/** One in-flight TASK whose `base` names another TASK, and whether that hold still stands. */
export type HoldStatus =
  | { readonly kind: 'held'; readonly task: string; readonly on: string }
  | { readonly kind: 'released'; readonly task: string }

/** A LEASE as it stands on disk: only when it was taken — nothing about whether it is alive. */
export type LeaseRecord = { readonly takenAt: string }

/** Whether a ready TASK's session should start now, or a live LEASE already covers it. */
export type LeaseDecision = { readonly kind: 'take' } | { readonly kind: 'blocked' }

/** One TASK as schedule needs it to decide readiness: its own state word, not `inflight`'s summary. */
export type ScheduleTask = {
  readonly task: string
  readonly word: string
}

/** Whether a fresh agent, reading both TASKs' intent, judged a relationship a real conflict. */
export type JudgeVerdict = { readonly kind: 'resolved' } | { readonly kind: 'unresolved' }

/** What a fresh agent is handed to judge one relationship: the edge itself, and both intents. */
export type RelationshipJudgeInput = {
  readonly relationship: Relationship
  /** Each TASK's intent document, by TASK name; a TASK whose intent could not be read is absent. */
  readonly intents: Readonly<Record<string, string>>
}

/**
 * One line of the raised-relationships ledger: that a relationship was put in front of a
 * human, or the human's own ruling on one already raised. Two kinds rather than one shape with
 * an optional `ruling`, so a line that only records raising it can never carry a ruling nobody
 * wrote.
 */
export type RaisedEntry =
  | { readonly kind: 'raised'; readonly key: string; readonly at: string }
  | { readonly kind: 'ruled'; readonly key: string; readonly at: string; readonly ruling: string }

/** The external actions a scheduling pass cannot perform itself: starting a real session, asking
 * a real fresh agent, and putting a finding in front of a real human. Each is required only when
 * a pass actually needs it — a pass with nothing ready and no relationship never calls any of them. */
export type ScheduleActions = {
  readonly startSession: (task: string) => Promise<void>
  readonly judge: (input: RelationshipJudgeInput) => Promise<JudgeVerdict>
  readonly notifyHuman: (relationship: Relationship) => Promise<void>
}

/** What one scheduling pass did. */
export type SchedulePlan = {
  readonly pruned: readonly string[]
  readonly started: readonly string[]
  readonly blocked: readonly string[]
  readonly raised: readonly Relationship[]
}
