/**
 * What `inflight` reads and answers. It reads no files and shells no git itself — `cli` hands
 * it strings for a MANIFEST and a state word, and the revisions git already resolved; this is
 * everything past that: what a TASK's own state means, and how in-flight TASK relate.
 */

/** The JSON hand-off a TASK's own worktree carries. `blocked` is present only when the TASK
 *  waits behind another: the TASK it waits for, and the reason its MANIFEST argues for the
 *  wait. Absent, the TASK's branch is cut from the BASE_BRANCH like any other. */
export type Manifest = {
  readonly intentRef: string
  readonly branch: string
  readonly blocked?: { readonly task: string; readonly reason: string }
}

/** A MANIFEST that stands, or the reason it does not. */
export type ManifestRead =
  | { readonly ok: true; readonly manifest: Manifest }
  | { readonly ok: false; readonly reason: string }

/** A TASK's state, read literally: the one word this tool knows as done, and everything else. */
export type TaskState = 'merged' | 'in-flight'

/** One CAPABILITY_FILE or TERM a TASK's branch stands on. */
export type Node =
  | { readonly kind: 'capability'; readonly name: string }
  | { readonly kind: 'term'; readonly name: string }

/** The TASK-to-TASK edge a `blocked` field records: which TASK this one waits behind, and
 *  the reason it waits. A manifest fact, verified in git by nobody. */
export type BlockedBy = { readonly task: string; readonly reason: string }

/**
 * One TASK as the graph answers it: its writes and reopened edges, its blockedBy edge when
 * its MANIFEST records one, and a problem when something about it did not hold. `problem`
 * rides beside the edges rather than replacing them, because a TASK whose branch reads fine
 * but whose `blocked` names a TASK the queue does not hold is still a TASK whose edges are
 * real.
 */
export type TaskEntry = {
  readonly task: string
  readonly writes: readonly Node[]
  readonly reopened: readonly Node[]
  readonly blockedBy: BlockedBy | null
  readonly problem: string | null
}

/** A CAPABILITY_FILE or TERM two or more in-flight TASK are attached to, naming each once. */
export type Relationship = { readonly node: Node; readonly tasks: readonly string[] }

/** What `inflight` answers: every TASK's edges, and the relationships between them. */
export type Graph = {
  readonly tasks: readonly TaskEntry[]
  readonly relationships: readonly Relationship[]
}
