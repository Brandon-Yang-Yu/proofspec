import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { readCensus } from '../cli/census.ts'
import type { CensusRead } from '../cli/census.ts'
import { enqueue } from '../cli/queue.ts'
import { schedule } from '../cli/run.ts'
import { piJudge } from '../cli/judge.ts'
import { stderrNotifyHuman } from '../cli/notify.ts'
import { liveSessionCount, tmuxStartSession } from '../cli/session.ts'
import type { Outcome } from '../cli/types.ts'
import type { Manifest, ManifestBase } from '../inflight/index.ts'
import type { ScheduleActions } from '../schedule/index.ts'

/** The flattened shape `enqueue_task` accepts from a model, before it is mapped onto the
 *  real `Manifest`/`ManifestBase` `readManifest` (`src/inflight/manifest.ts`) already parses. */
export type EnqueueTaskInput = {
  readonly task: string
  readonly intentRef: string
  readonly branch: string
  readonly base?: { readonly task: string; readonly reason: string }
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

/** Maps `enqueue_task`'s flattened input onto the exact `Manifest` shape `readManifest` parses. */
export function manifestFrom(input: EnqueueTaskInput): Manifest {
  const base: ManifestBase =
    input.base === undefined ? { kind: 'main' } : { kind: 'task', task: input.base.task, reason: input.base.reason }
  return { intentRef: input.intentRef, branch: input.branch, base }
}

export type EnqueueTaskResult =
  | { readonly ok: true; readonly task: string; readonly scheduled: Outcome }
  | { readonly ok: false; readonly reason: string }

/** The real actions a scheduling pass uses when nothing else is given: the same
 *  `tmuxStartSession`/`liveSessionCount`/`piJudge`/`stderrNotifyHuman` the bare CLI's own
 *  `schedule` command supplies (`src/cli/main.ts`). A test hands `runEnqueueTask` its own
 *  fakes instead. */
function realScheduleActions(cwd: string): ScheduleActions {
  return {
    startSession: task => tmuxStartSession(cwd, task),
    countSessions: liveSessionCount,
    judge: piJudge(),
    notifyHuman: stderrNotifyHuman(),
  }
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

/** The plain JSON Schema `enqueue_task`'s arguments must satisfy — no TypeBox schema needed,
 *  pi's own tool-argument validation falls back to plain JSON Schema when a schema carries
 *  no TypeBox marker. */
const ENQUEUE_TASK_PARAMETERS = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'The TASK name — a plain kebab-case slug, e.g. "fix-login-redirect"' },
    intentRef: { type: 'string', description: "Where this TASK's intent is written, e.g. a spec or doc path" },
    branch: { type: 'string', description: "The TASK's own branch name" },
    base: {
      type: 'object',
      description: 'The other TASK this one is built on, when it is not built on main',
      properties: {
        task: { type: 'string', description: 'The other TASK name' },
        reason: { type: 'string', description: 'Why this TASK is built on it' },
      },
      required: ['task', 'reason'],
    },
  },
  required: ['task', 'intentRef', 'branch'],
} as const

function toolResultFrom(result: EnqueueTaskResult): { content: [{ type: 'text'; text: string }]; details: EnqueueTaskResult } {
  const text = result.ok
    ? `TASK "${result.task}" is now queued. ${scheduleSummary(result.scheduled)}`
    : `Could not enqueue: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/** How the triggered pass's own outcome reads in `enqueue_task`'s text — never in place of the
 *  enqueue result above it, only alongside it (`specs/handoff.md`). */
function scheduleSummary(scheduled: Outcome): string {
  if (scheduled.kind === 'cannot-run') return `The scheduling pass it triggered could not run: ${scheduled.reason}`
  if (scheduled.kind !== 'scheduled') return `The scheduling pass it triggered answered unexpectedly (${scheduled.kind}).`
  const { pruned, started, blocked, deferred, raised } = scheduled.report
  return `The scheduling pass it triggered: pruned ${pruned.length}, started ${started.length}, blocked ${blocked.length}, deferred ${deferred.length}, raised ${raised.length}.`
}

/** `census_in_flight` takes no arguments: it answers for the whole repo it runs in, the same
 *  way `proofspec inflight` does. */
const CENSUS_IN_FLIGHT_PARAMETERS = { type: 'object', properties: {}, required: [] } as const

/**
 * The whole of `census_in_flight`'s own job: read the calling repo's queue directory and
 * answer the census `inflight` computes. This is the one hop in front of a read the
 * investigation agent cannot make by walking every in-flight TASK's own worktree itself, the
 * same way `enqueue_task` is the one hop in front of a write it cannot make by hand.
 */
export async function runCensusInFlight(cwd: string): Promise<CensusRead> {
  return readCensus(cwd)
}

function censusResultFrom(result: CensusRead): { content: [{ type: 'text'; text: string }]; details: CensusRead } {
  const text = result.ok
    ? JSON.stringify(result.census, null, 2)
    : `Could not read the in-flight census: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/** The real `pi` extension: registers `enqueue_task` and `census_in_flight` as tools a coding
 *  agent inside `pi` can call directly. */
export default function handoffExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'enqueue_task',
    label: 'Enqueue Task',
    description: "Hands a TASK off to ProofSpec's queue, creating its MANIFEST and initial queued state.",
    parameters: ENQUEUE_TASK_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const result = await runEnqueueTask(ctx.cwd, params)
      return toolResultFrom(result)
    },
  })

  pi.registerTool({
    name: 'census_in_flight',
    label: 'Census In-Flight',
    description:
      'Answers what every in-flight TASK has rewritten in specs/*.md on its own branch, relative to its own base — so a census can draft against the freshest view, not a main that is about to be stale.',
    parameters: CENSUS_IN_FLIGHT_PARAMETERS,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      const result = await runCensusInFlight(ctx.cwd)
      return censusResultFrom(result)
    },
  })
}
