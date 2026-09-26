import { spawn } from 'node:child_process'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { readState, writeExecutor } from '../cli/queue.ts'
import type { FireSchedulingPass } from '../cli/settle.ts'
import { createToolCore, isToolCore, piExecute, registrationsFor, resolveCore, resolveReportEnv, refreshHeartbeat } from '../mcp/core.ts'
import type { CoreOptions, PiToolResult, ReportEnv, ToolCore, ToolName } from '../mcp/core.ts'
import { BUILDING } from '../schedule/types.ts'

/**
 * The `pi` adapter for the progress tools (`specs/progress.md`, `specs/mcp.md`). Every rule —
 * `report_task_state`, `report_task_phase`, `settle_task`, and the heartbeat write — lives in
 * the one core both transports answer from (`src/mcp/core.ts`); this entry point only
 * registers the tools against `pi` and subscribes the heartbeat to the six observable-move
 * events, carrying every call straight to the core and every answer straight back. One act
 * is this transport's own, outside the shared contract: the provider-error watch, which
 * restarts a `building` TASK in the Claude Code harness when its `pi` session stops for good
 * on a provider error.
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
function defaultCore(fireSchedulingPass?: FireSchedulingPass): ToolCore {
  return createToolCore({ fireSchedulingPass })
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
 *  runs — the tool adds no conditions of its own and skips none. The five leading params are
 *  the execute signature pi imposes; what this boundary adds of its own rides the trailing
 *  options object, so the addition never compounds the imposed positionals (style rule 4). */
export function executeSettleTask(
  toolCallId: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: ExtensionContext,
  options?: { readonly fireSchedulingPass?: FireSchedulingPass },
): Promise<PiToolResult> {
  return piExecute(defaultCore(options?.fireSchedulingPass), 'settle_task')(toolCallId, params, signal, onUpdate, ctx)
}

/** The action that restarts a TASK's session, handed the queue entry to restart. Injectable
 *  — the same seam settle's `FireSchedulingPass` is — so a proof can observe the fire, or
 *  refuse it, without a real session ever being started. */
export type FireRestart = (restart: ReportEnv) => void | Promise<void>

/** What the extension can be handed: a `CoreInjection` — the core both transports answer
 *  from, bare or as `{ core }` — whose options shape also carries the restart action the
 *  provider-error watch fires. */
export type ProgressInjection = ToolCore | (CoreOptions & { readonly fireRestart?: FireRestart })

/** The restart's own script, run by a fresh `node`: `startSession` for the TASK against its
 *  queue root. Every value arrives through the environment, never spliced into the script,
 *  so a TASK name or a path is never read as code. */
const RESTART_SCRIPT =
  'const { tmuxStartSession } = await import(process.env.PROOFSPEC_RESTART_SESSION_MODULE); await tmuxStartSession(process.env.PROOFSPEC_QUEUE_ROOT, process.env.PROOFSPEC_TASK)'

/** The `startSession` module the restart imports, from the ProofSpec copy this extension was
 *  loaded from — the same copy that is watching, whatever the queue root holds. Its source
 *  under a checkout; its built JavaScript when that copy is an installed package, because
 *  node strips no types from a `.ts` file under `node_modules`. */
function restartSessionModule(): { readonly nodeFlags: readonly string[]; readonly url: string } {
  const ownPath = fileURLToPath(import.meta.url)
  if (ownPath.split(sep).includes('node_modules')) {
    return { nodeFlags: [], url: new URL('../../dist/cli/session.js', import.meta.url).href }
  }
  return { nodeFlags: ['--experimental-transform-types'], url: new URL('../cli/session.ts', import.meta.url).href }
}

/** Starts the TASK's session again from a process of its own: detached, in a process group of
 *  its own, and unref'd, like the settle's reaper — because `startSession` first kills the
 *  TASK's same-named tmux session, which is the very `pi` session asking for the restart.
 *  Answers once the process has started, and rejects when it could not be. */
function realFireRestart(restart: ReportEnv): Promise<void> {
  const session = restartSessionModule()
  return new Promise((resolve, reject) => {
    const child = spawn('node', [...session.nodeFlags, '--input-type=module', '-e', RESTART_SCRIPT], {
      cwd: restart.queueRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PROOFSPEC_RESTART_SESSION_MODULE: session.url,
        PROOFSPEC_QUEUE_ROOT: restart.queueRoot,
        PROOFSPEC_TASK: restart.task,
      },
    })
    child.once('error', reject)
    child.once('spawn', () => resolve())
    child.unref()
  })
}

/** Whether a run ended on a provider error: its last message is a reply pi recorded with
 *  `stopReason: 'error'` — the provider refusing, as opposed to finishing, running out of
 *  length, handing over to a tool, or being aborted. */
function endedOnProviderError(event: AgentEndEvent): boolean {
  const last = event.messages.at(-1)
  if (last === undefined || !('role' in last) || last.role !== 'assistant') return false
  return last.stopReason === 'error'
}

/** The watch's act at the stop for good: when the TASK is `building`, record claude as its
 *  executor, then fire the restart — the record first, so the start it fires reads claude.
 *  The queue entry is resolved the way `report_task_state` resolves it, and an unset
 *  variable means this session is not one the queue started, so nothing is guessed. */
async function restartInClaude(fireRestart: FireRestart): Promise<void> {
  const envResult = resolveReportEnv(process.env)
  if (!envResult.ok) return
  const { queueRoot, task } = envResult.env
  if ((await readState(queueRoot, task)) !== BUILDING) return
  await writeExecutor(queueRoot, task, 'claude')
  await fireRestart(envResult.env)
}

/**
 * The real `pi` extension: registers the four limbs `specs/progress.md` names —
 * `report_task_state` and `report_task_phase` (the words an executor session reports back),
 * `settle_task` (the one act among the four), and the heartbeat (the fact refreshed on every
 * move) — so a session tells the queue where it stands without ever needing to know where
 * its own worktree sits relative to the main checkout. An injected core (the MCP server's
 * own, say) makes the two transports answer from one core. Beside them it subscribes the
 * provider-error watch (`restartInClaude`).
 */
export default function progressExtension(pi: ExtensionAPI, injection?: ProgressInjection): void {
  // The heartbeat limb: the same zero-argument step subscribed to every move a session can be
  //  seen making — the six events the requirement pins and no others. A function of no
  //  parameters fits each handler signature, so no casts are needed.
  pi.on('turn_start', refreshHeartbeat)
  pi.on('turn_end', refreshHeartbeat)
  pi.on('tool_execution_start', refreshHeartbeat)
  pi.on('tool_execution_update', refreshHeartbeat)
  pi.on('tool_execution_end', refreshHeartbeat)
  pi.on('message_update', refreshHeartbeat)

  // The provider-error watch: `agent_end` says how each run ended, `agent_settled` that pi
  // will not go on by itself. Only the run ending last counts — a failed run pi then retried
  // past ends again on the retry, clearing the flag before the stop.
  const injectedRestart = injection === undefined || isToolCore(injection) ? undefined : injection.fireRestart
  const fireRestart = injectedRestart ?? realFireRestart
  let lastRunFailed = false
  pi.on('agent_end', event => {
    lastRunFailed = endedOnProviderError(event)
  })
  pi.on('agent_settled', async () => {
    if (!lastRunFailed) return
    await restartInClaude(fireRestart)
  })

  const core = resolveCore(injection)
  for (const registration of registrationsFor(PROGRESS_TOOLS)) {
    pi.registerTool({ ...registration, execute: piExecute(core, registration.name) })
  }
}
