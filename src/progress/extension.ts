import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createToolCore, piExecute, registrationsFor, resolveCore, refreshHeartbeat } from '../mcp/core.ts'
import type { CoreInjection, PiToolResult, ToolCore, ToolName } from '../mcp/core.ts'

/**
 * The `pi` adapter for the progress tools (`specs/progress.md`, `specs/mcp.md`). Every rule —
 * `report_task_state`, `report_task_phase`, `settle_task`, and the heartbeat write — lives in
 * the one core both transports answer from (`src/mcp/core.ts`); this entry point only
 * registers the tools against `pi` and subscribes the heartbeat to the six observable-move
 * events, carrying every call straight to the core and every answer straight back.
 */

// The rules' one home is the core; these re-exports keep their proofs where they stand
// (`tests/progress/*` imports them here).
export {
  REPORTABLE_STATES,
  refreshHeartbeat,
  resolveReportEnv,
  runReportTaskPhase,
  runReportTaskState,
  runSettleTask,
} from '../mcp/core.ts'
export type {
  ReportableState,
  ReportEnv,
  ReportTaskPhaseInput,
  ReportTaskPhaseResult,
  ReportTaskStateResult,
} from '../mcp/core.ts'

/** The tools this adapter registers — the progress third of the one surface table. */
const PROGRESS_TOOLS: readonly ToolName[] = ['report_task_state', 'report_task_phase', 'settle_task']

/**
 * The core the pi boundary functions below answer from. A fresh real core, so calling one of
 * them behaves exactly like calling the registered tool: same rules, same answers, with no
 * test-injected core in between.
 */
function defaultCore(): ToolCore {
  return createToolCore()
}

/** `report_task_state`'s pi boundary — pulled out so a test can call it directly with a
 *  constructed `ExtensionContext` and prove the queue and TASK are resolved from the
 *  environment, never from `ctx.cwd`. Resolves from `process.env`, never from `ctx.cwd`. */
export function executeReportTaskState(
  toolCallId: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<PiToolResult> {
  return piExecute(defaultCore(), 'report_task_state')(toolCallId, params, signal, onUpdate, ctx)
}

/** `report_task_phase`'s pi boundary, pulled out for the same reason `executeReportTaskState`
 *  is: a test calls it with a constructed `ExtensionContext` and proves the write lands under
 *  `PROOFSPEC_QUEUE_ROOT`, never under `ctx.cwd`. */
export function executeReportTaskPhase(
  toolCallId: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<PiToolResult> {
  return piExecute(defaultCore(), 'report_task_phase')(toolCallId, params, signal, onUpdate, ctx)
}

/** `settle_task`'s pi boundary, pulled out for the same reason: a test calls it with a
 *  constructed `ExtensionContext` and proves the settle resolves its queue from the
 *  environment, never from `ctx.cwd`. The settle itself is the shared one the scheduling pass
 *  runs — the tool adds no conditions of its own and skips none. */
export function executeSettleTask(
  toolCallId: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<PiToolResult> {
  return piExecute(defaultCore(), 'settle_task')(toolCallId, params, signal, onUpdate, ctx)
}

/**
 * The real `pi` extension: registers the four limbs `specs/progress.md` names —
 * `report_task_state` and `report_task_phase` (the words an executor session reports back),
 * `settle_task` (the one act among the four), and the heartbeat (the fact refreshed on every
 * move) — so a session tells the queue where it stands without ever needing to know where
 * its own worktree sits relative to the main checkout. An injected core (the MCP server's
 * own, say) makes the two transports answer from one core.
 */
export default function progressExtension(pi: ExtensionAPI, injection?: CoreInjection): void {
  // The heartbeat limb: the same zero-argument step subscribed to every move a session can be
  //  seen making — the six events the requirement pins and no others. A function of no
  //  parameters fits each handler signature, so no casts are needed.
  pi.on('turn_start', refreshHeartbeat)
  pi.on('turn_end', refreshHeartbeat)
  pi.on('tool_execution_start', refreshHeartbeat)
  pi.on('tool_execution_update', refreshHeartbeat)
  pi.on('tool_execution_end', refreshHeartbeat)
  pi.on('message_update', refreshHeartbeat)
  const core = resolveCore(injection)
  for (const registration of registrationsFor(PROGRESS_TOOLS)) {
    pi.registerTool({ ...registration, execute: piExecute(core, registration.name) })
  }
}
