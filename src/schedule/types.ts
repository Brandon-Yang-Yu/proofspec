import type { Relationship } from '../inflight/index.ts'

/**
 * The literal state word every other command reads. `inflight` collapses this to
 * merged/in-flight because that is all a graph needs; a LEASE has to tell `building` apart
 * from every other in-flight word, so schedule keeps the word itself.
 */
export const BUILDING = 'building'

/** The literal state word an executor's own report leaves behind once its TASK's work is done
 * and every gate it touched is clean — the executor's claim, which git's ancestry check is
 * asked to prove before anyone acts on it. */
export const MERGEABLE = 'mergeable'

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

/** One TASK as the merged-state producer needs it: the literal state word — the executor's
 * own claim its work is done — and the branch whose landing in main is git's to confirm. */
export type MergeCandidate = {
  readonly task: string
  readonly word: string
  readonly branch: string
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
 * a real fresh agent, and putting a finding in front of a real human. Each is optional and
 * required only when a pass actually needs it — supplying one is independent of supplying the
 * others, which is why an embedder that only has a real `startSession` can still call `schedule`
 * rather than being forced to fabricate a `judge` it would rather not pretend is real. */
export type ScheduleActions = {
  readonly startSession?: (task: string) => Promise<void>
  /** How many executor sessions stand live on the dedicated tmux server, asked of the server
   * itself — the one source the pass trusts, keeping no count of its own to drift. */
  readonly countSessions?: () => Promise<number>
  readonly judge?: (input: RelationshipJudgeInput) => Promise<JudgeVerdict>
  readonly notifyHuman?: (relationship: Relationship) => Promise<void>
}

/** What one scheduling pass did. */
export type SchedulePlan = {
  readonly merged: readonly string[]
  readonly pruned: readonly string[]
  readonly started: readonly string[]
  readonly blocked: readonly string[]
  /** TASKs the live-session bound left undispatched: still `queued`, carried no LEASE, and
   * dispatched by a later pass once a session has gone. */
  readonly deferred: readonly string[]
  readonly raised: readonly Relationship[]
}
