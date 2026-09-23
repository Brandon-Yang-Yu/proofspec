import { spawn } from 'node:child_process'
import { readCensus } from '../cli/census.ts'
import type { CensusRead } from '../cli/census.ts'
import { piJudge } from '../cli/judge.ts'
import { stderrNotifyHuman } from '../cli/notify.ts'
import { appendPhaseHistory, enqueue, readPhase, writeHeartbeat, writePhase, writeState } from '../cli/queue.ts'
import { schedule } from '../cli/run.ts'
import { liveSessionCount, tmuxStartSession } from '../cli/session.ts'
import { settleTask } from '../cli/settle.ts'
import type { FireSchedulingPass, SchedulingPassPlan, SettleResult } from '../cli/settle.ts'
import type { Outcome } from '../cli/types.ts'
import type { Manifest } from '../inflight/index.ts'
import { BUILDING } from '../schedule/types.ts'
import type { ScheduleActions } from '../schedule/index.ts'

/**
 * The one core both transports — the `pi` extensions (`src/progress/extension.ts`,
 * `src/handoff/extension.ts`) and the stdio MCP server (`src/mcp/server.ts`) — answer from.
 * Every rule a tool answers by lives here (`specs/mcp.md`): the transports carry calls to
 * the core and answers back, and decide nothing themselves, so the tools answer the same
 * whichever harness a session runs in.
 */

/** The five tools both transports expose, under the names both register them. */
export type ToolName = 'enqueue_task' | 'census_in_flight' | 'report_task_state' | 'report_task_phase' | 'settle_task'

/** One call as a rule receives it: the tool's own arguments, and the cwd of the carrying
 *  process — the only two facts a transport-neutral rule can be given. */
export type ToolCall = { readonly args: Record<string, unknown>; readonly cwd: string }

/** One tool's rule: answers the tool's whole decision. Rules sit in plain mutable fields on
 *  the core object, so a landed change to one tool's behavior is exactly one field. */
export type ToolRule = (call: ToolCall) => Promise<unknown>

/**
 * The core both transports answer from. The five rules are keyed by the name both transports
 * register them under; `call` is the one dispatch every adapter carries through. A rule field
 * is optional only so a proof can stand in a core of its own (`tests/mcp/adapter.test.ts`
 * injects a recording core that has nothing but `call`); the core `createToolCore` builds
 * always carries all five. The fields are mutable on purpose — a landed change to one tool's
 * behavior is exactly one field (`tests/mcp/server.test.ts` proves the one-core property by
 * replacing a rule once and watching both transports move).
 */
export type ToolCore = {
  enqueue_task?: ToolRule
  census_in_flight?: ToolRule
  report_task_state?: ToolRule
  report_task_phase?: ToolRule
  settle_task?: ToolRule
  call(tool: string, args: Readonly<Record<string, unknown>>, cwd?: string): Promise<unknown>
}

/** What an adapter may be handed beside its transport API: the core itself, or an options
 *  object carrying one — both shapes are load-bearing seams the proofs drive (`adapter.test.ts`
 * passes the core bare, `server.test.ts` wraps it as `{ core }`), so one adapter signature
 * serves both. Either way the adapter reaches every rule through the core it names. */
export type CoreInjection = ToolCore | { readonly core?: ToolCore }

/** The core an adapter answers from: the one injected, or a fresh real one. */
export function resolveCore(injection?: CoreInjection): ToolCore {
  if (injection === undefined) return createToolCore()
  if (isToolCore(injection)) return injection
  return injection.core ?? createToolCore()
}

function isToolCore(value: CoreInjection): value is ToolCore {
  return typeof (value as ToolCore).call === 'function'
}

// --- the rules ------------------------------------------------------------------------

/**
 * `report_task_state` is the one hop in front of `writeState` (`src/cli/queue.ts`) a running
 * executor session can actually take — see `specs/progress.md` for why it reads
 * `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` from the environment rather than the session's own
 * working directory, which names the TASK's worktree, not the main checkout the queue lives
 * under.
 */

/** The two facts a report needs to address the queue: where it lives, and which TASK it is for. */
export type ReportEnv = { readonly queueRoot: string; readonly task: string }

/** `resolveReportEnv`'s own result: the resolved env, or which variable was missing. */
type ReportEnvResult = { readonly ok: true; readonly env: ReportEnv } | { readonly ok: false; readonly reason: string }

/** What a tool refuses with — the failure limb every rule here answers as a value. */
export type Refusal = { readonly ok: false; readonly reason: string }

/** Resolves the queue root and TASK name a report is for, refusing outright — never falling
 *  back to a working directory or guessing — when either is missing from the environment. */
export function resolveReportEnv(env: Readonly<Record<string, string | undefined>>): ReportEnvResult {
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
    await writePhase(env.queueRoot, env.task, { phase: word, round: resolvedRound, since })
    await appendPhaseHistory(env.queueRoot, env.task, { phase: word, round: resolvedRound, since: now })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: `TASK ${env.task} has no queue entry to report a phase into` }
    throw error
  }
  return { ok: true, task: env.task, phase: word, round: resolvedRound }
}

/**
 * The settle limb's pure half: the shared settle (`src/cli/settle.ts`) pointed at the queue
 * and TASK the environment names. Everything the tool promises beyond this — resolving
 * `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` the same way `report_task_state` does, refusing
 * rather than guessing when either is missing — is the rule's, here in the core.
 */
export function runSettleTask(env: ReportEnv, fireSchedulingPass?: FireSchedulingPass): Promise<SettleResult> {
  return settleTask({ queueRoot: env.queueRoot, task: env.task, fireSchedulingPass })
}

/**
 * The heartbeat's whole step: resolve the entry exactly as `report_task_state` does — the same
 * two environment variables, the same refusal to guess when either is missing — and leave the
 * current instant in it. Only the one expected failure is caught: an entry pruned mid-session
 * (`ENOENT`) is ordinary for a fire-and-forget fact nobody asked for, and is swallowed because
 * the heartbeat going stale is itself the signal. Every other fault propagates to the caller's
 * own error surface — the same ENOENT-only split `runReportTaskState` keeps, except there a
 * caller asked, so its refusal is answered as a value instead of left to the error surface.
 *
 * One write, two triggers (`specs/mcp.md`): the `pi` transport subscribes its observable-move
 * events to this function, and the heartbeat CLI entry (`src/mcp/heartbeat.ts`) the Claude
 * Code hooks run calls it — the same write either way, so the `heartbeat` file means the same
 * whichever harness fired it.
 */
export async function refreshHeartbeat(): Promise<void> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return
  try {
    await writeHeartbeat(envResult.env.queueRoot, envResult.env.task, new Date().toISOString())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

/** The flattened shape `enqueue_task` accepts from a model, before it is mapped onto the
 *  real `Manifest` `readManifest` (`src/inflight/manifest.ts`) already parses. */
export type EnqueueTaskInput = {
  readonly task: string
  readonly intentRef: string
  readonly branch: string
  readonly blocked?: { readonly task: string; readonly reason: string }
}

/** Whether a TASK name is safe to use as a filesystem path segment at all. */
export type TaskNameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const TASK_NAME_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/

/**
 * `enqueue(cwd, task, manifest)` (`src/cli/queue.ts`) builds its path as `join(cwd,
 * '.proofspec', 'dispatch', task)` with no check at all on `task` — safe until now only
 * because nothing ever called it with a `task` that did not already come from a trusted
 * caller. This is the first caller whose `task` arrives from a model's own text, so the
 * shape this repo's own TASK names already follow has to become an actual gate, run before
 * `enqueue()`'s own `join` ever sees the value.
 */
export function checkTaskName(task: string): TaskNameCheck {
  if (TASK_NAME_PATTERN.test(task)) return { ok: true }
  return {
    ok: false,
    reason: `"${task}" is not a plain kebab-case slug: it must start with a lowercase letter and contain only lowercase letters, digits, and hyphens, with no trailing hyphen`,
  }
}

/** Maps `enqueue_task`'s flattened input onto the exact `Manifest` shape `readManifest` parses:
 *  a `blocked` omitted writes no field at all, and one given is written exactly as given. */
export function manifestFrom(input: EnqueueTaskInput): Manifest {
  if (input.blocked === undefined) return { intentRef: input.intentRef, branch: input.branch }
  return { intentRef: input.intentRef, branch: input.branch, blocked: input.blocked }
}

export type EnqueueTaskResult =
  | { readonly ok: true; readonly task: string; readonly scheduled: Outcome }
  | { readonly ok: false; readonly reason: string }

/** The real actions a scheduling pass uses when nothing else is given: the same
 *  `tmuxStartSession`/`liveSessionCount`/`piJudge`/`stderrNotifyHuman` the bare CLI's own
 *  `schedule` command supplies (`src/cli/main.ts`). A caller hands `runEnqueueTask` its own
 *  actions instead. */
function realScheduleActions(cwd: string): ScheduleActions {
  return {
    startSession: task => tmuxStartSession(cwd, task),
    // The count and the start must name one server: both derive their socket from the same
    // queue root, never the reading process's own cwd — the MCP server lives in whatever
    // directory its harness spawned it from, which is not the repo's root.
    countSessions: () => liveSessionCount(cwd),
    judge: piJudge(),
    notifyHuman: stderrNotifyHuman(),
  }
}

/** The real fire a successful settle runs when nothing else is given: starts the pass the
 *  plan names the way the reaper is started (`reapSession`, `src/cli/session.ts`) — detached
 *  and unref'd, in a process group of its own — so the pass survives the settle's own
 *  teardown. The settle awaits only whether the pass *started* (never its exit): a start
 *  that cannot even happen surfaces as the ok limb's finding, never a failed settle. */
function realFireSchedulingPass(plan: SchedulingPassPlan): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, [...plan.args], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => resolve())
    child.unref()
  })
}

/**
 * The whole of `enqueue_task`'s own job: validate the TASK name, flatten the input onto a
 * real `Manifest`, then answer exactly what `enqueue()` answers — its own write outcome is
 * `enqueue()`'s to decide, not re-judged here. Once a TASK is genuinely newly queued, a
 * scheduling pass runs immediately — the event `specs/schedule.md` already names, closed here
 * (`specs/handoff.md`, "A successful enqueue immediately triggers a scheduling pass"). A
 * refusal to enqueue returns before that pass ever runs: nothing new entered the queue.
 */
export async function runEnqueueTask(cwd: string, input: EnqueueTaskInput, scheduleActions?: ScheduleActions): Promise<EnqueueTaskResult> {
  const nameCheck = checkTaskName(input.task)
  if (!nameCheck.ok) return nameCheck

  const manifest = manifestFrom(input)
  const result = await enqueue(cwd, input.task, manifest)
  if (!result.ok) return result

  const scheduled = await schedule({ cwd, schedule: scheduleActions ?? realScheduleActions(cwd) })
  return { ok: true, task: input.task, scheduled }
}

/**
 * The whole of `census_in_flight`'s own job: read the calling repo's queue directory and
 * answer the census `inflight` computes. This is the one hop in front of a read the
 * investigation agent cannot make by walking every in-flight TASK's own worktree itself, the
 * same way `enqueue_task` is the one hop in front of a write it cannot make by hand.
 */
export async function runCensusInFlight(cwd: string): Promise<CensusRead> {
  return readCensus(cwd)
}

// --- the tool surface both transports register ----------------------------------------

/** One tool as both transports register it: the words a model reads, and the plain JSON
 *  Schema its arguments must satisfy — one table, so the two transports can never publish
 *  the same tool under different parameters (`specs/mcp.md`). */
export type ToolRegistration = {
  readonly name: ToolName
  readonly label: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

const ENQUEUE_TASK_PARAMETERS = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'The TASK name — a plain kebab-case slug, e.g. "fix-login-redirect"' },
    intentRef: { type: 'string', description: "Where this TASK's intent is written, e.g. a spec or doc path" },
    branch: { type: 'string', description: "The TASK's own branch name" },
    blocked: {
      type: 'object',
      description: 'The TASK that blocks this one, when it must wait behind another TASK before starting',
      properties: {
        task: { type: 'string', description: 'The blocking TASK name' },
        reason: { type: 'string', description: 'Why this TASK waits behind it' },
      },
      required: ['task', 'reason'],
    },
  },
  required: ['task', 'intentRef', 'branch'],
} as const

const CENSUS_IN_FLIGHT_PARAMETERS = { type: 'object', properties: {}, required: [] } as const

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

const SETTLE_TASK_PARAMETERS = {
  type: 'object',
  properties: {},
} as const

/** The five tools, as both transports register them — the one table every registration reads. */
export const TOOL_SURFACE: readonly ToolRegistration[] = [
  {
    name: 'enqueue_task',
    label: 'Enqueue Task',
    description: "Hands a TASK off to ProofSpec's queue, creating its MANIFEST and initial queued state.",
    parameters: ENQUEUE_TASK_PARAMETERS,
  },
  {
    name: 'census_in_flight',
    label: 'Census In-Flight',
    description:
      'Answers what every in-flight TASK has rewritten in specs/*.md on its own branch, relative to the BASE_BRANCH — so a census can draft against the freshest view, not a main that is about to be stale.',
    parameters: CENSUS_IN_FLIGHT_PARAMETERS,
  },
  {
    name: 'report_task_state',
    label: 'Report Task State',
    description: "Reports this executor session's own state (building, mergeable, or blocked-on-question) back to the queue entry that started it.",
    parameters: REPORT_TASK_STATE_PARAMETERS,
  },
  {
    name: 'report_task_phase',
    label: 'Report Task Phase',
    description: "Reports this executor session's own pace word and round (where inside its pipeline the work stands — test red, build, a review round) back to the queue entry that started it. The vocabulary is the executor persona's own; the queue enforces none of it.",
    parameters: REPORT_TASK_PHASE_PARAMETERS,
  },
  {
    name: 'settle_task',
    label: 'Settle Task',
    description: 'Settles this session\'s own TASK once its merge has landed in the BASE_BRANCH: re-verifies from git that the TASK is mergeable and its branch is an ancestor of that branch, then rewrites the state to merged, fires one best-effort scheduling pass against the queue root — detached, so it survives the teardown — removes the TASK\'s worktree, and kills this session through a delayed reaper. Refuses, touching nothing, when either condition fails.',
    parameters: SETTLE_TASK_PARAMETERS,
  },
]

/** The tools one adapter registers, drawn from the one surface table. */
export function registrationsFor(names: readonly ToolName[]): readonly ToolRegistration[] {
  return TOOL_SURFACE.filter(tool => names.includes(tool.name))
}

// --- the answers both transports give --------------------------------------------------

/** How the triggered pass's own outcome reads in `enqueue_task`'s text — never in place of the
 *  enqueue result above it, only alongside it (`specs/handoff.md`). Total over any value: the
 *  text is the answer's reading, never a second judge of what the answer may be. */
function scheduleSummary(scheduled: unknown): string {
  const outcome = scheduled as Outcome | undefined
  if (outcome === null || typeof outcome !== 'object' || typeof outcome.kind !== 'string') {
    return 'The scheduling pass it triggered answered with nothing to report.'
  }
  if (outcome.kind === 'cannot-run') return `The scheduling pass it triggered could not run: ${outcome.reason}`
  if (outcome.kind !== 'scheduled') return `The scheduling pass it triggered answered unexpectedly (${outcome.kind}).`
  const { pruned, started, blocked, deferred, raised } = outcome.report
  return `The scheduling pass it triggered: pruned ${pruned.length}, started ${started.length}, blocked ${blocked.length}, deferred ${deferred.length}, raised ${raised.length}.`
}

/**
 * How a tool's answer reads as the text a model sees — one formatter, so both transports give
 * the same words for the same answer (`specs/mcp.md`). The answer itself is the value; this is
 * only its reading.
 */
export function answerText(tool: ToolName, answer: unknown): string {
  const result = answer as Refusal | { readonly ok: true } & Record<string, unknown>
  if (!result.ok) return refusalText(tool, result.reason)
  switch (tool) {
    case 'enqueue_task':
      return `TASK "${(answer as { task: string }).task}" is now queued. ${scheduleSummary((answer as { scheduled: Outcome }).scheduled)}`
    case 'census_in_flight':
      return JSON.stringify((answer as { census: unknown }).census, null, 2)
    case 'report_task_state':
      return 'Reported.'
    case 'report_task_phase':
      return `Reported phase ${(answer as { phase: string }).phase} (round ${(answer as { round: number }).round}).`
    case 'settle_task':
      return `Settled TASK ${(answer as { task: string }).task}: state rewritten to merged, worktree removed, session kill scheduled through the reaper.`
    default:
      return assertNeverTool(tool)
  }
}

function refusalText(tool: ToolName, reason: string): string {
  switch (tool) {
    case 'enqueue_task':
      return `Could not enqueue: ${reason}`
    case 'census_in_flight':
      return `Could not read the in-flight census: ${reason}`
    case 'report_task_state':
      return `Could not report state: ${reason}`
    case 'report_task_phase':
      return `Could not report phase: ${reason}`
    case 'settle_task':
      return `Could not settle: ${reason}`
    default:
      return assertNeverTool(tool)
  }
}

function assertNeverTool(tool: never): string {
  throw new Error(`answerText: no such tool ${tool as string}`)
}

/** A pi tool's whole result: the content blocks the model reads, and the structured answer
 *  the harness reads — the envelope every pi registration answers in. */
export type PiToolResult = {
  readonly content: [{ readonly type: 'text'; readonly text: string }]
  readonly details: unknown
}

/**
 * A pi tool's `execute` for one core tool: carry the call to the core unchanged, wrap the
 * answer in the pi envelope — no validation, no policy, nothing of the adapter's own
 * (`specs/mcp.md`, "An adapter carries transport only, never a rule").
 */
export function piExecute(core: ToolCore, tool: ToolName) {
  return async (
    _toolCallId: string,
    params: Readonly<Record<string, unknown>>,
    _signal: AbortSignal | undefined,
    _onUpdate: unknown,
    ctx: { readonly cwd: string },
  ): Promise<PiToolResult> => {
    const answer = await core.call(tool, params, ctx.cwd)
    return { content: [{ type: 'text', text: answerText(tool, answer) }], details: answer }
  }
}

// --- the factory ----------------------------------------------------------------------

/**
 * Builds the one core: the five tools' rules, keyed by the name both transports register
 * them under. The scheduling actions the enqueue rule's triggered pass runs are injectable,
 * so a proof can keep that pass from ever touching tmux (`tests/mcp/server.test.ts`).
 */
export function createToolCore(options?: { readonly scheduleActions?: ScheduleActions; readonly fireSchedulingPass?: FireSchedulingPass }): ToolCore {
  const core: ToolCore = {
    enqueue_task: async ({ args, cwd }) => runEnqueueTask(cwd, args as unknown as EnqueueTaskInput, options?.scheduleActions),
    census_in_flight: async ({ cwd }) => runCensusInFlight(cwd),
    report_task_state: async ({ args }) => {
      const envResult = resolveReportEnv(process.env)
      if (!envResult.ok) return envResult
      return runReportTaskState(envResult.env, (args as { state: string }).state)
    },
    report_task_phase: async ({ args }) => {
      const envResult = resolveReportEnv(process.env)
      if (!envResult.ok) return envResult
      const { phase, round } = args as { phase: string; round?: number }
      return runReportTaskPhase(envResult.env, phase, round)
    },
    settle_task: async () => {
      const envResult = resolveReportEnv(process.env)
      if (!envResult.ok) return envResult
      return runSettleTask(envResult.env, options?.fireSchedulingPass ?? realFireSchedulingPass)
    },
    call(tool, args, cwd = process.cwd()) {
      // Read through the object's own field, never a closure copy: a rule changed on the core
      // is the one landed change both transports must answer together.
      const rule = core[tool as ToolName]
      if (rule === undefined) return Promise.reject(new Error(`no rule for tool ${tool}`))
      return rule({ args: args as Record<string, unknown>, cwd })
    },
  }
  return core
}
