import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { writeHeartbeat, writeState } from '../cli/queue.ts'
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
 *  `enqueue`'s own initial write; `merged` has no producer yet (docs/design.md §49). `BUILDING`
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
 * current instant in it. A write that fails is swallowed, never answered or thrown: a heartbeat
 * is a fact a session leaves behind, not a promise to anyone, so no caller is waiting for a
 * reply, and the heartbeat going stale is itself the signal. `runReportTaskState` answers its
 * failure as a value because there a caller asked; here nobody did.
 */
async function refreshHeartbeat(): Promise<void> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return
  try {
    await writeHeartbeat(envResult.env.queueRoot, envResult.env.task, new Date().toISOString())
  } catch {
    // Swallowed on purpose — the reasoning above: nobody asked, so nobody is owed a refusal.
  }
}

/** The real `pi` extension: registers `report_task_state` so an executor session can tell a
 *  scheduling pass it is live, without ever needing to know where its own worktree sits
 *  relative to the main checkout. */
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
}
