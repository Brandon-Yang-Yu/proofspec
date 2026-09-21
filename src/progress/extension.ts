import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { settleTask } from '../cli/settle.ts'
import type { SettleResult } from '../cli/settle.ts'
import { appendPhaseHistory, readPhase, writeHeartbeat, writePhase, writeState } from '../cli/queue.ts'
import { BUILDING } from '../schedule/types.ts'

/**
 * `report_task_state` is the one hop in front of `writeState` (`src/cli/queue.ts`) a running
 * executor session can actually take — see `specs/progress.md` for why it reads
 * `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` from the environment rather than
 * `ExtensionContext.cwd`, which names the session's own worktree, not the main checkout the
 * queue lives under.
 */

/** The two facts a report needs to address the queue: where it lives, and which TASK it is for. */
export type ReportEnv = { readonly queueRoot: string; readonly task: string }

/** `resolveReportEnv`'s own result: the resolved env, or which variable was missing. */
type ReportEnvResult = { readonly ok: true; readonly env: ReportEnv } | { readonly ok: false; readonly reason: string }

/** Resolves the queue root and TASK name a report is for, refusing outright — never falling
 *  back to `cwd` or guessing — when either is missing from the environment. Not exported: its
 *  refusals are only provable for real through `executeReportTaskState`, the boundary that
 *  actually has a filesystem and a `cwd` to (not) fall back to. */
function resolveReportEnv(env: Readonly<Record<string, string | undefined>>): ReportEnvResult {
  const queueRoot = env.PROOFSPEC_QUEUE_ROOT
  if (queueRoot === undefined) return { ok: false, reason: 'PROOFSPEC_QUEUE_ROOT is not set' }
  const task = env.PROOFSPEC_TASK
  if (task === undefined) return { ok: false, reason: 'PROOFSPEC_TASK is not set' }
  return { ok: true, env: { queueRoot, task } }
}

/** The closed set of state words an executor may report on itself. `queued` belongs to
 *  `enqueue`'s own initial write; `merged` is written only by the settle, never by the session
 *  that did the merging (docs/design.md, "Docket"). `BUILDING`
 *  is reused, not copied, since `leaseDecision` (`src/schedule/lease.ts`) already compares a
 *  TASK's own state word against that exact constant. */
export const REPORTABLE_STATES = [BUILDING, 'mergeable', 'blocked-on-question'] as const
export type ReportableState = (typeof REPORTABLE_STATES)[number]

function isReportableState(state: string): state is ReportableState {
  return (REPORTABLE_STATES as readonly string[]).includes(state)
}

export type ReportTaskStateResult =
  | { readonly ok: true; readonly task: string; readonly state: ReportableState }
  | { readonly ok: false; readonly reason: string }

/** What a settle refuses with — the failure limb both the env resolution and the settle
 *  itself answer with, named once so the boundary below can say what it takes without
 *  spelling the shape out a second time. */
type Refusal = { readonly ok: false; readonly reason: string }

/**
 * The settle limb's pure half: the shared settle (`src/cli/settle.ts`) pointed at the queue
 * and TASK the environment names. Everything the tool promises beyond this — resolving
 * `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` the same way `report_task_state` does, refusing
 * rather than guessing when either is missing — is `executeSettleTask`'s, the boundary that
 * actually has an environment to read.
 */
export function runSettleTask(env: ReportEnv): Promise<SettleResult> {
  return settleTask({ queueRoot: env.queueRoot, task: env.task })
}

const SETTLE_TASK_PARAMETERS = {
  type: 'object',
  properties: {},
} as const

/** The answer a settle gives the model that called it — the same shape the report tool's
 *  boundary answers in, so a caller reads either tool's outcome the same way. */
type SettleToolResult = {
  readonly content: [{ readonly type: 'text'; readonly text: string }]
  readonly details: SettleResult
}

/**
 * The settle tool's `execute`, pulled out for the same reason `executeReportTaskState` is:
 * a test can call it with a constructed `ExtensionContext` and prove the queue and TASK are
 * resolved from the environment, never from `ctx.cwd`. The settle itself is the shared one
 * the scheduling pass runs — the tool adds no conditions of its own and skips none.
 */
export async function executeSettleTask(
  _toolCallId: string,
  _params: Record<string, never>,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: ExtensionContext,
): Promise<SettleToolResult> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return settleToolResultFrom(envResult)
  return settleToolResultFrom(await runSettleTask(envResult.env))
}

function settleToolResultFrom(result: SettleResult | Refusal): SettleToolResult {
  const text = result.ok
    ? `Settled TASK ${result.task}: state rewritten to merged, worktree removed, session kill scheduled through the reaper.`
    : `Could not settle: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/**
 * The whole of `report_task_state`'s own job: judge the word is one an executor may report,
 * then delegate the write itself entirely to `writeState`, which judges nothing about it. A
 * queue entry can vanish between an executor being told to report and this call actually
 * running — pruned once nothing still names it — so exactly that `ENOENT` is caught here and
 * answered as a value, the same reason `enqueue_task` never throws either; anything else
 * `writeState` throws (permissions, disk) is a real fault and still propagates.
 */
export async function runReportTaskState(env: ReportEnv, state: string): Promise<ReportTaskStateResult> {
  if (!isReportableState(state)) {
    return { ok: false, reason: `"${state}" is not a reportable state: must be one of ${REPORTABLE_STATES.join(', ')}` }
  }
  try {
    await writeState(env.queueRoot, env.task, state)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: `TASK ${env.task} has no queue entry to report state into` }
    throw error
  }
  return { ok: true, task: env.task, state }
}

const REPORT_TASK_STATE_PARAMETERS = {
  type: 'object',
  properties: {
    state: {
      type: 'string',
      enum: [...REPORTABLE_STATES],
      description: "This executor session's own state: building, mergeable, or blocked-on-question",
    },
  },
  required: ['state'],
} as const

type ReportToolResult = { content: [{ type: 'text'; text: string }]; details: ReportEnvResult | ReportTaskStateResult }

function toolResultFrom(result: ReportEnvResult | ReportTaskStateResult): ReportToolResult {
  const text = result.ok ? 'Reported.' : `Could not report state: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/** What `report_task_phase` may be asked to write: the executor's own word for where
 *  inside its pipeline the work stands, and which round of it — for the gates that loop. */
export type ReportTaskPhaseInput = { readonly phase: string; readonly round?: number }

export type ReportTaskPhaseResult =
  | { readonly ok: true; readonly task: string; readonly phase: string; readonly round: number }
  | { readonly ok: false; readonly reason: string }

/**
 * The pace-word limb's whole job: judge the word is a word (non-empty once trimmed — the
 * queue enforces no vocabulary of its own, because the vocabulary belongs to the executor
 * persona and evolves without the queue's permission) and the round an integer of 1 or more
 * (defaulting to 1, the first pass through any step), then write what the entry's own
 * standing calls for through `writePhase`/`appendPhaseHistory`. The pruned-entry refusal
 * keeps the same ENOENT-only boundary `runReportTaskState` keeps, for the same reason a
 * caller's refusal is answered as a value.
 */
export async function runReportTaskPhase(env: ReportEnv, phase: string, round?: number): Promise<ReportTaskPhaseResult> {
  const word = phase.trim()
  if (word === '') return { ok: false, reason: 'phase must be a non-empty word, not empty or only whitespace' }
  const resolvedRound = round ?? 1
  if (!Number.isInteger(resolvedRound) || resolvedRound < 1) {
    return { ok: false, reason: `round must be an integer of 1 or more, not ${round}` }
  }
  try {
    // One moment per report: on a word change the phase file's `since` and the appended
    // entry's must name the same instant, so `now` is read exactly once and never again.
    const now = Date.now()
    // An absent, old-shape, or garbage phase file reads back as no standing to match — a
    // file this tool did not write cannot vouch for a `since` worth keeping.
    const standing = await readPhase(env.queueRoot, env.task)
    if (standing !== undefined && standing.phase === word && standing.round === resolvedRound) {
      // The report that changed nothing writes nothing — not the file, not the history: an
      // entry appended for it would say a standing began that never began. Still answered
      // ok, because nothing changed and nothing failed.
      return { ok: true, task: env.task, phase: word, round: resolvedRound }
    }
    // A round move keeps the `since` the file records — only the word's beginning moves it —
    // while a word change (or no standing to match) begins a new one at now.
    const since = standing !== undefined && standing.phase === word ? standing.since : now
    await writePhase(env.queueRoot, env.task, word, resolvedRound, since)
    await appendPhaseHistory(env.queueRoot, env.task, { phase: word, round: resolvedRound, since: now })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: `TASK ${env.task} has no queue entry to report a phase into` }
    throw error
  }
  return { ok: true, task: env.task, phase: word, round: resolvedRound }
}

const REPORT_TASK_PHASE_PARAMETERS = {
  type: 'object',
  properties: {
    phase: {
      type: 'string',
      description: "This executor session's own word for where inside its pipeline the work stands (the executor persona's vocabulary; the queue enforces none of it)",
    },
    round: {
      type: 'integer',
      minimum: 1,
      description: 'Which round of the phase, for the gates that loop (default 1)',
    },
  },
  required: ['phase'],
} as const

type PhaseToolResult = { content: [{ type: 'text'; text: string }]; details: Refusal | ReportTaskPhaseResult }

function phaseToolResultFrom(result: Refusal | ReportTaskPhaseResult): PhaseToolResult {
  const text = result.ok
    ? `Reported phase ${result.phase} (round ${result.round}).`
    : `Could not report phase: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/** The phase tool's `execute`, pulled out for the same reason `executeReportTaskState` is: a
 *  test calls it with a constructed `ExtensionContext` and proves the write lands under
 *  `PROOFSPEC_QUEUE_ROOT`, never under `ctx.cwd`. */
export async function executeReportTaskPhase(
  _toolCallId: string,
  params: ReportTaskPhaseInput,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: ExtensionContext,
): Promise<PhaseToolResult> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return phaseToolResultFrom(envResult)
  return phaseToolResultFrom(await runReportTaskPhase(envResult.env, params.phase, params.round))
}

/**
 * The tool's actual `execute`, pulled out so a test can call it directly with a constructed
 * `ExtensionContext` — the one way to prove `_ctx` really is ignored, rather than trusting the
 * unused-parameter name. Resolves from `process.env`, never from `ctx.cwd`.
 */
export async function executeReportTaskState(
  _toolCallId: string,
  params: { readonly state: string },
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  _ctx: ExtensionContext,
): Promise<ReportToolResult> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return toolResultFrom(envResult)
  const result = await runReportTaskState(envResult.env, params.state)
  return toolResultFrom(result)
}

/**
 * The heartbeat's whole step: resolve the entry exactly as `report_task_state` does — the same
 * two environment variables, the same refusal to guess when either is missing — and leave the
 * current instant in it. Only the one expected failure is caught: an entry pruned mid-session
 * (`ENOENT`) is ordinary for a fire-and-forget fact nobody asked for, and is swallowed because
 * the heartbeat going stale is itself the signal. Every other fault propagates to pi's own
 * handler dispatch, which reports it without crashing the session — the same ENOENT-only split
 * `runReportTaskState` keeps, except there a caller asked, so its refusal is answered as a
 * value instead of left to the error surface.
 */
async function refreshHeartbeat(): Promise<void> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return
  try {
    await writeHeartbeat(envResult.env.queueRoot, envResult.env.task, new Date().toISOString())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/** The real `pi` extension: registers the four limbs `specs/progress.md` names —
 *  `report_task_state` and `report_task_phase` (the words an executor session reports back),
 *  `settle_task` (the one act among the four), and the heartbeat (the fact refreshed on every
 *  move) — so a session tells the queue where it stands without ever needing to know where
 *  its own worktree sits relative to the main checkout. */
export default function progressExtension(pi: ExtensionAPI): void {
  // The heartbeat limb: the same zero-argument step subscribed to every move a session can be
  //  seen making — the six events the requirement pins and no others. A function of no
  //  parameters fits each handler signature, so no casts are needed.
  pi.on('turn_start', refreshHeartbeat)
  pi.on('turn_end', refreshHeartbeat)
  pi.on('tool_execution_start', refreshHeartbeat)
  pi.on('tool_execution_update', refreshHeartbeat)
  pi.on('tool_execution_end', refreshHeartbeat)
  pi.on('message_update', refreshHeartbeat)
  pi.registerTool({
    name: 'report_task_state',
    label: 'Report Task State',
    description: "Reports this executor session's own state (building, mergeable, or blocked-on-question) back to the queue entry that started it.",
    parameters: REPORT_TASK_STATE_PARAMETERS,
    execute: executeReportTaskState,
  })
  // The pace-word limb: the executor's own account of where inside its pipeline the work
  // stands, beside the round for the gates that loop. The state word is the machine's closed
  // contract; this one is free on purpose — a closed set here would freeze the persona's
  // pipeline into the queue.
  pi.registerTool({
    name: 'report_task_phase',
    label: 'Report Task Phase',
    description: "Reports this executor session's own pace word and round (where inside its pipeline the work stands — test red, build, a review round) back to the queue entry that started it. The vocabulary is the executor persona's own; the queue enforces none of it.",
    parameters: REPORT_TASK_PHASE_PARAMETERS,
    execute: executeReportTaskPhase,
  })
  // The settle limb: the one call that finishes a TASK. Registered with no parameters of its
  // own because it takes nothing on trust — the TASK it settles is the one the environment
  // names, and whether that TASK may be settled is answered from the queue and from git,
  // never from the caller.
  pi.registerTool({
    name: 'settle_task',
    label: 'Settle Task',
    description: 'Settles this session\'s own TASK once its merge has landed in main: re-verifies from git that the TASK is mergeable and its branch is an ancestor of main, then rewrites the state to merged, removes the TASK\'s worktree, and kills this session through a delayed reaper. Refuses, touching nothing, when either condition fails.',
    parameters: SETTLE_TASK_PARAMETERS,
    execute: executeSettleTask,
  })
}
