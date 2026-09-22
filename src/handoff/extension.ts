import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { piExecute, registrationsFor, resolveCore } from '../mcp/core.ts'
import type { CoreInjection, PiToolResult, ToolName } from '../mcp/core.ts'

/**
 * The `pi` adapter for the handoff tools (`specs/handoff.md`, `specs/mcp.md`). Every rule —
 * `enqueue_task`'s name gate and triggered scheduling pass, `census_in_flight`'s read — lives
 * in the one core both transports answer from (`src/mcp/core.ts`); this entry point only
 * registers the tools against `pi`, carrying every call straight to the core and every answer
 * straight back.
 */

// The rules' one home is the core; these re-exports keep their proofs where they stand
// (`tests/handoff/*` imports them here).
export { checkTaskName, manifestFrom, runCensusInFlight, runEnqueueTask } from '../mcp/core.ts'
export type { EnqueueTaskInput, EnqueueTaskResult, TaskNameCheck } from '../mcp/core.ts'

/** The tools this adapter registers — the handoff third of the one surface table. */
const HANDOFF_TOOLS: readonly ToolName[] = ['enqueue_task', 'census_in_flight']

/**
 * The real `pi` extension: registers `enqueue_task` and `census_in_flight` as tools a coding
 * agent inside `pi` can call directly. An injected core (the MCP server's own, say) makes the
 * two transports answer from one core.
 */
export default function handoffExtension(pi: ExtensionAPI, injection?: CoreInjection): void {
  const core = resolveCore(injection)
  for (const registration of registrationsFor(HANDOFF_TOOLS)) {
    pi.registerTool({ ...registration, execute: piExecute(core, registration.name) })
  }
}
