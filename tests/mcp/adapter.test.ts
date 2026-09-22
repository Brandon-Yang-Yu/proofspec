// Capability: mcp

import { expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import progressExtension from '../../src/progress/extension.ts'
import handoffExtension from '../../src/handoff/extension.ts'
import { mcpCallTool } from '../../src/mcp/server.ts'
import type { ToolCore } from '../../src/mcp/core.ts'

// The conduit property this file proves: an adapter that passes every argument through
// unchanged and returns every core answer unchanged can neither validate an argument, decide
// a policy, nor hold a second copy of a rule — and any adapter that does any of those stops
// being a conduit, because each one shows up as an argument or an answer that changed in
// flight.
//
// The seam: both adapters reach every rule through one core (`ToolCore`, `src/mcp/core.ts`)
// — `call(tool, args)` answering the tool's whole decision — and each accepts the core it
// delegates to, so the proof runs against a core whose answers are known in advance and
// whose every received call is recorded. The pi adapter is the two extension entry points
// (`src/progress/extension.ts`, `src/handoff/extension.ts`) with the core injected beside
// the `ExtensionAPI`; the MCP adapter is `mcpCallTool` (`src/mcp/server.ts`), the one
// carrying the stdio server's tool-call handling delegates to, with the core injected the
// same way. The wire envelope around an answer — like the pi result's own content text — is
// transport formatting, not part of the answer carried; that the two transports answer the
// same values is the tools-surface requirement's claim, proven in `tests/mcp/server.test.ts`.

/** One carried call as the proof hands it to a transport: the tool's name and the arguments
 *  exactly as a caller would hand them. Each argument is chosen so a smuggled rule would
 *  show — a TASK name the queue's own slug gate refuses, a state word outside the reportable
 *  set, a phase word still carrying its whitespace. A conduit carries them all; only the
 *  core judges. */
type CarriedCall = { readonly tool: string; readonly args: Readonly<Record<string, unknown>> }

const CALLS: readonly CarriedCall[] = [
  { tool: 'enqueue_task', args: { task: 'A Real TASK', intentRef: 'docs/x.md', branch: 'work/anything' } },
  { tool: 'census_in_flight', args: {} },
  { tool: 'report_task_state', args: { state: 'vibing' } },
  { tool: 'report_task_phase', args: { phase: '  tests-red  ', round: 2 } },
  { tool: 'settle_task', args: {} },
]

/** The core's answers, fixed in advance — each carrying a `marker` field only the core could
 *  know, and the settle answered as a refusal, so an adapter that rebuilds answers from a
 *  template of its own, re-words a refusal, or substitutes a refusal of its own (the very
 *  second copy this requirement forbids) stops matching. */
const KNOWN_ANSWERS: Readonly<Record<string, unknown>> = {
  enqueue_task: { ok: true, task: 'A Real TASK', marker: 'enqueue-task answer' },
  census_in_flight: { ok: true, census: [], marker: 'census answer' },
  report_task_state: { ok: true, task: 'a', state: 'vibing', marker: 'state answer' },
  report_task_phase: { ok: true, task: 'a', phase: '  tests-red  ', round: 2, marker: 'phase answer' },
  settle_task: { ok: false, reason: 'the core refuses this settle', marker: 'settle answer' },
}

/** One call as the recording core below received it. */
type ReceivedCall = { readonly tool: string; readonly args: unknown }

/** A core whose answers are known and whose every received call is recorded — the stand-in
 *  the conduit property is proven against. */
function recordingCore(received: ReceivedCall[]): ToolCore {
  return {
    async call(tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
      received.push({ tool, args })
      return KNOWN_ANSWERS[tool]
    },
  }
}

/** A registered pi tool as this proof drives it: the execute the transport would call. The
 *  parameters a tool is registered under are the tools-surface requirement's claim, not this
 *  one's; the carrying is all that matters here. */
type RegisteredTool = {
  readonly name: string
  readonly execute: (
    toolCallId: string,
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ readonly details: unknown }>
}

/** Registers both pi extension entry points against a fake `ExtensionAPI` that records every
 *  registered tool, with the core injected — the same recording pattern
 *  `tests/progress/extension.test.ts` keeps for the heartbeat's event subscriptions. */
function registerPiTools(core: ToolCore): ReadonlyMap<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>()
  const pi = {
    on: (): void => {},
    registerTool: (tool: RegisteredTool): void => {
      tools.set(tool.name, tool)
    },
  }
  progressExtension(pi as unknown as ExtensionAPI, core)
  handoffExtension(pi as unknown as ExtensionAPI, core)
  return tools
}

// Requirement: An adapter carries transport only, never a rule
// Scenario: The pi adapter carries calls to the core unchanged, and answers back unchanged
// GIVEN calls through the pi registration, with the core's answers for them known
// WHEN each call is carried
// THEN the argument the core receives is exactly the argument the transport was handed,
//      and the answer the caller receives is exactly the answer the core produced — the
//      adapter neither refuses, rewrites, nor adds anything of its own
it('carries the pi registration\'s calls to the core unchanged, and answers back unchanged', async () => {
  const received: ReceivedCall[] = []
  const tools = registerPiTools(recordingCore(received))
  const ctx = { cwd: '/an/unrelated/directory' } as unknown as ExtensionContext

  for (const { tool, args } of CALLS) {
    const registered = tools.get(tool)
    expect(registered, `the pi registration exposes ${tool}`).toBeDefined()
    // A copy of the arguments, so an adapter that mutates what it was handed cannot pass by
    // having mutated the pristine literal too.
    const result = await registered!.execute(`call-${tool}`, structuredClone(args), undefined, undefined, ctx)
    expect(received.at(-1), `${tool}'s argument reached the core exactly as handed`).toEqual({ tool, args })
    // `details` is where a pi tool result carries its structured answer — the value the
    // caller reads, beside the envelope's own content text.
    expect(result.details, `${tool}'s answer reached the caller exactly as the core produced it`).toEqual(KNOWN_ANSWERS[tool])
  }

  // Exactly the five carried calls, in the order carried — nothing refused on the way in,
  // nothing of the adapter's own added on the way past.
  expect(received).toEqual(CALLS.map(({ tool, args }) => ({ tool, args })))
})

// Requirement: An adapter carries transport only, never a rule
// Scenario: The MCP adapter carries calls to the core unchanged, and answers back unchanged
// GIVEN calls through the MCP server, with the core's answers for them known
// WHEN each call is carried
// THEN the argument the core receives is exactly the argument the transport was handed,
//      and the answer the caller receives is exactly the answer the core produced — the
//      adapter neither refuses, rewrites, nor adds anything of its own
it('carries the MCP server\'s calls to the core unchanged, and answers back unchanged', async () => {
  const received: ReceivedCall[] = []
  const core = recordingCore(received)

  for (const { tool, args } of CALLS) {
    // A copy of the arguments, for the same mutation-proofing reason as above.
    const answer = await mcpCallTool(tool, structuredClone(args), core)
    expect(received.at(-1), `${tool}'s argument reached the core exactly as handed`).toEqual({ tool, args })
    expect(answer, `${tool}'s answer reached the caller exactly as the core produced it`).toEqual(KNOWN_ANSWERS[tool])
  }

  expect(received).toEqual(CALLS.map(({ tool, args }) => ({ tool, args })))
})
