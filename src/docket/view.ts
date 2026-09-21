import { compareStrings } from '../order.ts'
import { readManifest } from '../inflight/index.ts'
import { rulingCommandFor } from '../schedule/index.ts'
import type { ManifestBase, Node } from '../inflight/index.ts'
import type { RaisedEntry } from '../schedule/index.ts'
import type { PhaseHistoryEntry } from '../cli/queue.ts'

/**
 * The docket view: one row per queue entry, plus every raised-but-unruled relationship. It
 * reads no files and runs no processes — every fact arrives as it was read from where some
 * other capability already wrote it (`cli` owns the filesystem and the process, the same
 * split `inflight` keeps) — and it judges nothing: the rows carry the words and the numbers
 * as they stand, and what any reader makes of them is the reader's to decide.
 */

/** One TASK's entry as read: its MANIFEST and state as strings, or the reason that TASK alone
 * could not be read. The same shape `readQueue` answers, restated here so this capability
 * depends on nothing outside it. */
export type QueueEntryRead =
  | { readonly ok: true; readonly task: string; readonly manifest: string; readonly state: string }
  | { readonly ok: false; readonly task: string; readonly reason: string }

/** When a TASK's two files were last written, as the filesystem itself recorded it — the ages
 * are read from these, tracked nowhere else. The heartbeat is optional because its absence is
 * the ordinary state of a TASK with no session, not an error. */
export type TaskTimes = {
  readonly task: string
  readonly stateWrittenAt: number
  readonly heartbeatWrittenAt: number | undefined
}

/** A TASK's pace word as one fact-cluster: the word, its round, and the moment the word
 *  began running — as the `phase` file's own content records it, not its write time —
 *  present only for a TASK whose phase file reads, so presence in the list is the whole
 *  difference between a row that carries a phase and a row that carries three absences. */
export type TaskPhase = {
  readonly task: string
  readonly phase: string
  readonly round: number
  readonly since: number
}

/** One archived TASK's entry as read from the archive directory: its MANIFEST as raw text,
 *  plus the two write times every number the record carries is read from — the MANIFEST's
 *  for when the TASK was enqueued, the `state` file's for when it was settled. Tracked
 *  nowhere else, the same way a live row's ages are read from its own files' write times.
 *  The same shape `readArchive` (`src/cli/queue.ts`) answers, restated here so this
 *  capability depends on nothing outside it — the same restatement `QueueEntryRead` makes. */
export type ArchiveEntryRead = {
  readonly task: string
  readonly manifest: string
  readonly manifestWrittenAt: number
  readonly stateWrittenAt: number
  /** The archived entry's own phase history, riding the directory the prune moved whole —
   *  `undefined` for a TASK that kept none, an ordinary absence rather than a problem. */
  readonly history: readonly PhaseHistoryEntry[] | undefined
}

/** One word's share of a phase account: the word, the total time spent in it (separate runs
 *  summed under the one word), the highest round it reached, and whether it is the standing
 *  still running — live on a row, always closed in an archive. */
export type PhaseAccountEntry = {
  readonly word: string
  readonly totalSeconds: number
  readonly roundsReached: number
  readonly live: boolean
}

/** One completed TASK as the archive answers it: the TASK's name, the branch and base its
 *  MANIFEST records, when it was enqueued, when it was settled, and how long it lived — the
 *  last three read from the entry's own file write times on the request that asks for them. */
export type ArchiveRecord = {
  readonly task: string
  readonly branch: string
  readonly base: ManifestBase
  readonly enqueuedAt: string
  readonly settledAt: string
  readonly livedSeconds: number
  /** Every standing the archived TASK stood through, as its own `phase-history` file holds
   *  them — `null` when it kept none. */
  readonly phaseHistory: readonly PhaseHistoryEntry[] | null
  /** The record's account of that history, computed on the request that asks: every phase
   *  closed, the last entry's time ending at the settled moment. */
  readonly phaseAccount: readonly PhaseAccountEntry[] | null
}

/** Whether the dedicated tmux server still holds a session named for the TASK. A listed
 * session carries its exact attach command; an absent one carries nothing, because there is
 * nothing further to ask about it. */
export type SessionWhereabouts =
  | { readonly listed: true; readonly attach: string }
  | { readonly listed: false }

/** One queue entry as the docket answers it: the TASK's name, its state word exactly as its
 * `state` file holds it, its phase word and round exactly as its `phase` file holds them, the
 * branch and base its MANIFEST records, how long it has stood in its word, how long since its
 * session last moved, how long its phase word has stood, the history of every standing it
 * stood through, and whether its session is still there to attach to. */
export type DocketRow = {
  readonly task: string
  readonly state: string
  /** The literal phase word, never translated — an unknown word on a docket is a signal to
 *  look, not an error to hide. */
  readonly phase: string | null
  /** The round the phase file holds — absent exactly when the word is, never defaulted. */
  readonly round: number | null
  readonly branch: string
  readonly base: ManifestBase
  readonly stateAgeSeconds: number
  /** Absent — `null`, never a repeat of the word's own age — when the TASK has no heartbeat
   * file: the ordinary state of a TASK with no session. */
  readonly heartbeatAgeSeconds: number | null
  /** Absent the same way when the TASK has no `phase` file — its own number, never a repeat of
 *  the word's or the heartbeat's. */
  readonly phaseAgeSeconds: number | null
  /** Every standing the TASK has stood through, as its `phase-history` file holds them —
   *  `null` when no readable history stands. */
  readonly phaseHistory: readonly PhaseHistoryEntry[] | null
  /** The row's account of that history, computed on the read that carries it: one entry per
   *  word in first-standing order, the current word's total live, every closed word closed. */
  readonly phaseAccount: readonly PhaseAccountEntry[] | null
  readonly session: SessionWhereabouts
}

/** One queue entry that could not be read, naming the TASK so every other TASK's row can
 * still stand. */
export type DocketProblem = {
  readonly task: string
  readonly reason: string
}

/** A relationship raised but not yet ruled: the one debt the queue cannot pay itself. Carries
 * everything a human needs to rule on it, including the exact command line that records the
 * ruling. `node` and `tasks` are parsed back off the key `schedule` raised the relationship
 * under; a key that does not carry the shape `relationshipKey` writes leaves them unset
 * rather than invented, with the key itself still standing. */
export type OutstandingRuling = {
  readonly node: Node | null
  readonly tasks: readonly string[]
  readonly key: string
  readonly answerWith: string
}

/** What the docket answers: a row per readable queue entry, a problem per unreadable one, and
 * every ruling still outstanding. Rows are ordered by TASK name alone — two runs over the
 * same queue stay comparable, and no age, word, or problem moves a TASK up the list. */
export type Docket = {
  readonly rows: readonly DocketRow[]
  readonly problems: readonly DocketProblem[]
  readonly outstanding: readonly OutstandingRuling[]
}

/** The external action the docket needs: the dedicated tmux server's own session list.
 * Optional and injected the same way `ScheduleActions` injects its actions, so a test (or an
 * embedder) can answer it without a real tmux server ever being asked. */
export type DocketActions = {
  readonly listSessions?: () => Promise<readonly string[]>
}

/** The docket over facts already read: one row per readable entry sorted by TASK name, a
 * problem per unreadable one, and every relationship raised but not yet ruled. */
export function docketView(input: {
  readonly entries: readonly QueueEntryRead[]
  readonly times: readonly TaskTimes[]
  /** TASK name → its pace word, round, and the moment the word began, for exactly the TASKs
   *  whose phase file reads. */
  readonly phases: ReadonlyMap<string, TaskPhase>
  /** TASK name → every standing its `phase-history` file holds, for exactly the TASKs whose
   *  history file reads. */
  readonly histories: ReadonlyMap<string, readonly PhaseHistoryEntry[]>
  /** Session name → its exact attach command, for exactly the sessions the server listed. */
  readonly sessions: ReadonlyMap<string, string>
  readonly raised: readonly RaisedEntry[]
  readonly now: Date
}): Docket {
  const rows: DocketRow[] = []
  const problems: DocketProblem[] = []
  const times = new Map(input.times.map(one => [one.task, one]))
  for (const entry of [...input.entries].sort((a, b) => compareStrings(a.task, b.task))) {
    if (!entry.ok) {
      problems.push({ task: entry.task, reason: entry.reason })
      continue
    }
    const manifest = readManifest(entry.manifest)
    if (!manifest.ok) {
      problems.push({ task: entry.task, reason: manifest.reason })
      continue
    }
    const time = times.get(entry.task)
    if (time === undefined) {
      problems.push({ task: entry.task, reason: `TASK ${entry.task}'s state file could not be read` })
      continue
    }
    const phase = input.phases.get(entry.task)
    const history = input.histories.get(entry.task)
    rows.push({
      task: entry.task,
      // The literal word, never translated: an unknown word on a docket is a signal to look,
      // not an error to hide.
      state: entry.state,
      phase: phase?.phase ?? null,
      round: phase?.round ?? null,
      branch: manifest.manifest.branch,
      base: manifest.manifest.base,
      stateAgeSeconds: secondsAgo(input.now, time.stateWrittenAt),
      heartbeatAgeSeconds: time.heartbeatWrittenAt === undefined ? null : secondsAgo(input.now, time.heartbeatWrittenAt),
      // The age of the word, not of the file: the file is rewritten on every round move, so
      // its write time would say how long since the last round — the moment the word began
      // is the file's own content, out of the writes' reach.
      phaseAgeSeconds: phase === undefined ? null : secondsAgo(input.now, phase.since),
      phaseHistory: history ?? null,
      phaseAccount: history === undefined ? null : phaseAccountFrom(history, input.now.getTime(), history.at(-1)?.phase ?? null),
      session: sessionFor(entry.task, input.sessions),
    })
  }
  return { rows, problems, outstanding: outstandingRulings(input.raised) }
}

/** The archive over facts already read: one record per archived TASK, ordered by each
 *  TASK's start time — the enqueued moment — latest first, earliest last, so the most
 *  recently enqueued TASK stands at the top where the eye lands first. Debt reads before
 *  history is the page-side reason the completed section sits last; this is the data-side
 *  reason for the same ordering — a chronology, newest first. An entry whose MANIFEST
 *  cannot be parsed is skipped rather than answered half-invented: entries arrive whole
 *  by construction (the prune moves them untouched), and a hand-damaged archive is outside
 *  what this view promises to judge. */
export function archiveView(entries: readonly ArchiveEntryRead[]): readonly ArchiveRecord[] {
  const started = [...entries].sort(
    (a, b) => b.manifestWrittenAt - a.manifestWrittenAt || compareStrings(a.task, b.task),
  )
  const records: ArchiveRecord[] = []
  for (const entry of started) {
    const manifest = readManifest(entry.manifest)
    if (!manifest.ok) continue
    records.push({
      task: entry.task,
      branch: manifest.manifest.branch,
      base: manifest.manifest.base,
      enqueuedAt: new Date(entry.manifestWrittenAt).toISOString(),
      settledAt: new Date(entry.stateWrittenAt).toISOString(),
      // Never negative: a settle that reads before its own enqueue is a clock that moved,
      // not a TASK that finished before it began — the same floor `secondsAgo` keeps.
      livedSeconds: Math.max(0, Math.floor((entry.stateWrittenAt - entry.manifestWrittenAt) / 1000)),
      phaseHistory: entry.history ?? null,
      // No standing is live here — the TASK is finished — and the last entry's run ends at
      // the settled moment, the one end this record already reads.
      phaseAccount: entry.history === undefined ? null : phaseAccountFrom(entry.history, entry.stateWrittenAt, null),
    })
  }
  return records
}

function sessionFor(task: string, sessions: ReadonlyMap<string, string>): SessionWhereabouts {
  const attach = sessions.get(task)
  return attach === undefined ? { listed: false } : { listed: true, attach }
}

/**
 * Requirement: The answer names every relationship raised but not yet ruled
 *
 * Every raised entry whose key carries no ruling yet, each named once and in the order the
 * record raised them. The record keeps a ruling forever; the view keeps only what is still
 * owed.
 */
export function outstandingRulings(raised: readonly RaisedEntry[]): readonly OutstandingRuling[] {
  const ruled = new Set(raised.filter(entry => entry.kind === 'ruled').map(entry => entry.key))
  const outstanding: OutstandingRuling[] = []
  const named = new Set<string>()
  for (const entry of raised) {
    if (entry.kind !== 'raised' || ruled.has(entry.key) || named.has(entry.key)) continue
    named.add(entry.key)
    const parsed = relationshipFromKey(entry.key)
    outstanding.push({
      node: parsed?.node ?? null,
      tasks: parsed?.tasks ?? [],
      key: entry.key,
      answerWith: rulingCommandFor(entry.key),
    })
  }
  return outstanding
}

/**
 * The node and TASKs a relationship key names, parsed back off the one string the
 * raised-record keeps. `relationshipKey` writes `${kind}:${name}:${tasks joined by ','}` —
 * the kind never holds a colon and the joined TASKs sit after the last one, so first and
 * last split the three parts apart without the name having to promise it holds no colon.
 * A key that does not carry the shape answers nothing.
 */
export function relationshipFromKey(key: string): { readonly node: Node; readonly tasks: readonly string[] } | undefined {
  const first = key.indexOf(':')
  const last = key.lastIndexOf(':')
  if (first === -1 || last === first) return undefined
  const kind = key.slice(0, first)
  const name = key.slice(first + 1, last)
  const tasks = key.slice(last + 1).split(',')
  if ((kind !== 'capability' && kind !== 'term') || name === '' || tasks.some(task => task === '')) return undefined
  return { node: { kind, name }, tasks }
}

/** The account of one history at a moment: each entry runs from the moment it records to
 *  the moment the next records, the last to `endsAtMs` — now for a live row, the settled
 *  moment for an archived record — so the standing still running is the one whose time
 *  still moves. Words keep first-standing order, separate runs under one word sum into its
 *  one total — milliseconds summed, floored once at the total, because a floor per run
 *  would lose a second per entry and make a word's total read less than the unbroken stint
 *  the row's own `in phase` column shows for it. The rounds reached are the highest round
 *  the word ever stood. `liveWord` names the standing still running — `null` when none is,
 *  the archive's ordinary case. */
function phaseAccountFrom(
  history: readonly PhaseHistoryEntry[],
  endsAtMs: number,
  liveWord: string | null,
): readonly PhaseAccountEntry[] {
  const accounts: { word: string; totalMs: number; roundsReached: number }[] = []
  const where = new Map<string, number>()
  history.forEach((entry, index) => {
    const next = history.at(index + 1)
    const ms = Math.max(0, (next === undefined ? endsAtMs : next.since) - entry.since)
    const slot = where.get(entry.phase)
    if (slot === undefined) {
      where.set(entry.phase, accounts.length)
      accounts.push({ word: entry.phase, totalMs: ms, roundsReached: entry.round })
      return
    }
    const standing = accounts[slot]!
    accounts[slot] = {
      word: standing.word,
      totalMs: standing.totalMs + ms,
      roundsReached: Math.max(standing.roundsReached, entry.round),
    }
  })
  return accounts.map(account => ({
    word: account.word,
    totalSeconds: Math.floor(account.totalMs / 1000),
    roundsReached: account.roundsReached,
    live: account.word === liveWord,
  }))
}

/** Seconds since a recorded moment, floored — and never negative: a moment in the future is
 *  a clock that moved, not a TASK that moved before it was written. */
function secondsAgo(now: Date, since: number): number {
  return Math.max(0, Math.floor((now.getTime() - since) / 1000))
}
