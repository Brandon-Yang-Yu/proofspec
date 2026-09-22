// Capability: mcp

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createToolCore } from '../../src/mcp/core.ts'
import { serveMcp } from '../../src/mcp/server.ts'
import progressExtension from '../../src/progress/extension.ts'
import handoffExtension from '../../src/handoff/extension.ts'
import { cleanupRepos, enterTask, makeGitRepo, makeRepo } from '../cli/support.ts'

const execFileAsync = promisify(execFile)

afterEach(cleanupRepos)
// Unconditional, the same leaked-ambient-state guard `tests/progress/extension.test.ts` keeps.
afterEach(() => {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
})
afterEach(async () => {
  await execFileAsync('tmux', ['-L', SOCKET, 'kill-server']).catch(() => {})
})

// A settle — reached through either transport — schedules its detached reaper against the
// tmux socket named here, set once for the whole file and never deleted: the same guard
// `tests/progress/settle.test.ts` keeps, for the same reason.
const SOCKET = 'proofspec-mcp-test'
process.env.PROOFSPEC_TMUX_SOCKET = SOCKET

/** The five tool names the requirement enumerates — the one list every claim here measures
 *  both transports against. */
const TOOLS = ['enqueue_task', 'census_in_flight', 'report_task_state', 'report_task_phase', 'settle_task'] as const
type ToolName = (typeof TOOLS)[number]

/** A realistic call for each tool — the arguments the one-core claim's before/after calls
 *  carry. No rule ever reads them in that claim (the change replaces the rule), but the
 *  calls stay real so the carrying itself is what the transports do every day. */
const SAMPLE_ARGS: Record<ToolName, Record<string, unknown>> = {
  enqueue_task: { task: 'changed-once', intentRef: 'docs/x.md', branch: 'work/changed-once' },
  census_in_flight: {},
  report_task_state: { state: 'building' },
  report_task_phase: { phase: 'explorer', round: 1 },
  settle_task: {},
}

// --- the seam this proof drives --------------------------------------------------------
//
// The intent pins the shape — one core that both transports (the existing pi extensions and
// a new stdio MCP server under src/mcp/) answer from — and this proof pins how a test
// reaches that shape in-process:
//
//   - `createToolCore` (src/mcp/core.ts) builds the one core: the five tools' rules, keyed
//     by the name both transports register them under, with the scheduling actions the
//     enqueue rule's triggered pass runs injectable, so a proof can keep that pass from
//     ever touching tmux.
//   - `serveMcp` (src/mcp/server.ts) serves that core over a stdio pair, speaking
//     newline-delimited JSON-RPC — the MCP wire protocol a Claude Code process speaks —
//     rooted at a cwd of the caller's choosing. A tools/call answer carries the same
//     content blocks the pi tool answers with, and the core's own value under
//     `structuredContent`.
//   - Both pi extensions accept the same core as an option, so one core instance can stand
//     behind both transports at once.

/** One core rule: transport-neutral — the tool's own arguments and the cwd of the carrying
 *  process. Rules sit in plain mutable fields on purpose: replacing one rule once, on the
 *  one core both transports answer from, is how "written nowhere else" is made observable. */
type CoreRule = (call: { readonly args: Record<string, unknown>; readonly cwd: string }) => Promise<unknown>

/** The core as this proof drives it: five rules keyed by the tool name both transports use. */
type ToolCore = Record<ToolName, CoreRule>

/** The pi extensions as this proof drives them: registering their tools against `pi`,
 *  optionally bound to a core both transports share. */
type PiExtensionEntry = (pi: ExtensionAPI, options?: { readonly core?: ToolCore }) => void

/** `createToolCore` as this proof drives it. */
type CreateToolCore = (options?: { readonly scheduleActions?: Record<string, unknown> }) => ToolCore

/** `serveMcp` as this proof drives it: serve the core over a stdio pair, closable on demand. */
type ServeMcp = (options: {
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  readonly core?: ToolCore
  readonly cwd?: string
}) => { readonly close: () => Promise<void> }

const registerProgress = progressExtension as unknown as PiExtensionEntry
const registerHandoff = handoffExtension as unknown as PiExtensionEntry
const createCore = createToolCore as unknown as CreateToolCore
const serve = serveMcp as unknown as ServeMcp

/** A registration's parameter schema, as either transport publishes it — the names are what
 *  the one-for-one comparison reads. */
type ParameterSchema = { readonly properties?: Readonly<Record<string, unknown>>; readonly required?: readonly string[] }

/** A tool as the pi transport registers it: the parameters it publishes and the execute the
 *  extension hands pi. */
type RegisteredTool = {
  readonly name: string
  readonly parameters: ParameterSchema
  readonly execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ readonly content: unknown; readonly details: unknown }>
}

/** One answer as its caller receives it, from either transport: the content blocks the model
 *  reads, and the structured value the harness reads — the two halves "the same value" is
 *  compared through, so a caller cannot tell which transport carried the call. */
type Answer = { readonly content: unknown; readonly structured: unknown }

/** Registers the pi transport — both extensions — against a recording fake, so the tools it
 *  exposes can be read back and its execute called directly. The heartbeat subscriptions are
 *  accepted and ignored: the heartbeat is progress's own concern, not this claim's. */
function registerPiTools(core?: ToolCore): ReadonlyMap<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>()
  const pi = {
    on: (): void => {},
    registerTool: (tool: RegisteredTool): void => {
      tools.set(tool.name, tool)
    },
  }
  const options = core === undefined ? undefined : { core }
  registerProgress(pi as unknown as ExtensionAPI, options)
  registerHandoff(pi as unknown as ExtensionAPI, options)
  return tools
}

/** Carries one call through the pi transport, against the cwd a segment's world names. */
async function callThroughPi(
  piTools: ReadonlyMap<string, RegisteredTool>,
  tool: ToolName,
  args: Record<string, unknown>,
  cwd: string,
): Promise<Answer> {
  const registered = piTools.get(tool)
  if (registered === undefined) throw new Error(`the pi extensions registered no ${tool} tool`)
  const result = await registered.execute(`call-${tool}`, args, undefined, undefined, { cwd } as unknown as ExtensionContext)
  return { content: result.content, structured: result.details }
}

/** A minimal stdio MCP client: newline-delimited JSON-RPC over the same kind of stream pair
 *  a real Claude Code process would hand the server — initialize, then tools/list and
 *  tools/call, which is the whole of the protocol surface these claims need. */
type McpClient = {
  readonly tools: ReadonlyArray<{ readonly name: string; readonly inputSchema: ParameterSchema }>
  callTool(tool: string, args: Record<string, unknown>): Promise<Answer>
  close(): Promise<void>
}

/** How long one request may wait for its answer before the proof gives up on the server. */
const REQUEST_TIMEOUT_MS = 5_000

async function startMcp(options: { readonly core?: ToolCore; readonly cwd?: string }): Promise<McpClient> {
  const toServer = new PassThrough()
  const fromServer = new PassThrough()
  const server = serve({ input: toServer, output: fromServer, core: options.core, cwd: options.cwd })

  const pending = new Map<number, { readonly resolve: (result: unknown) => void; readonly reject: (error: Error) => void }>()
  let nextId = 0
  let buffer = ''
  fromServer.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let newlineAt = buffer.indexOf('\n')
    while (newlineAt !== -1) {
      const line = buffer.slice(0, newlineAt)
      buffer = buffer.slice(newlineAt + 1)
      newlineAt = buffer.indexOf('\n')
      const message = parseMessage(line)
      // Notifications carry no id; a response nobody waits on is not this client's concern.
      if (message === undefined || message.id === undefined) continue
      const waiter = pending.get(message.id)
      if (waiter === undefined) continue
      pending.delete(message.id)
      if (message.error !== undefined) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  })

  async function request(method: string, params?: unknown): Promise<unknown> {
    const id = ++nextId
    toServer.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`no answer to ${method} within ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, {
        resolve: result => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  }

  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'proofspec-mcp-proof', version: '0' },
  })
  toServer.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const listed = (await request('tools/list')) as { readonly tools?: ReadonlyArray<{ readonly name: string; readonly inputSchema: ParameterSchema }> }
  return {
    tools: listed.tools ?? [],
    async callTool(tool, args) {
      const result = (await request('tools/call', { name: tool, arguments: args })) as { readonly content?: unknown; readonly structuredContent?: unknown }
      return { content: result.content, structured: result.structuredContent }
    },
    async close() {
      toServer.end()
      await server.close()
    },
  }
}

/** One wire line as a JSON-RPC message, or undefined for a line that is empty or not JSON. */
function parseMessage(line: string): { readonly id?: number; readonly result?: unknown; readonly error?: { readonly message: string } } | undefined {
  if (line.trim() === '') return undefined
  try {
    return JSON.parse(line) as { readonly id?: number; readonly result?: unknown; readonly error?: { readonly message: string } }
  } catch {
    return undefined
  }
}

/** The parameter names one schema asks for, in one order — "every parameter one names, the
 *  other names" is a comparison of names, not of descriptions. */
function parameterNames(schema: ParameterSchema): readonly string[] {
  return Object.keys(schema.properties ?? {}).sort()
}

/** The parameters one schema demands, in one order — a parameter one transport requires and
 *  the other leaves optional is not the same registration. */
function requiredNames(schema: ParameterSchema): readonly string[] {
  return [...(schema.required ?? [])].sort()
}

// --- the worlds a call is carried against ----------------------------------------------

/** The enqueue world: a git repo whose queue is empty and whose TASK's branch already stands —
 *  the arrangement `tests/handoff/extension.test.ts` uses for the same call, with the
 *  triggered scheduling pass unable to run (no actions given), so both transports answer the
 *  one deterministic outcome. */
async function enqueueWorld(): Promise<string> {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await repo.git(['branch', 'work/same-answer'])
  return repo.root
}

/** The census world: a git repo with one TASK entered on its own branch — a census with
 *  something to count, read-only, so both transports can read the same world. */
async function censusWorld(): Promise<string> {
  const repo = await makeGitRepo({ 'a.txt': 'a\n' })
  await enterTask(repo, 'same-answer', { edit: 'a.txt' })
  return repo.root
}

/** A world whose queue directory cannot be read at all — a file where the directory belongs —
 *  so the census refuses. Built once and shared: its refusal names the path, and the claim is
 *  that both transports answer the same value, not that two paths answer alike. */
async function unreadableQueueWorld(): Promise<string> {
  const repo = await makeRepo({})
  await mkdir(join(repo.root, '.proofspec'), { recursive: true })
  await writeFile(join(repo.root, '.proofspec', 'dispatch'), 'a file where the queue directory belongs')
  return repo.root
}

/** The report world: one queue entry in the state given, named by the environment the way a
 *  dispatched session's environment names it. A report answers the same value however many
 *  times it runs, so one world can carry both transports' copies. */
async function reportWorld(state: string): Promise<string> {
  const repo = await makeRepo({})
  const entry = join(repo.root, '.proofspec', 'dispatch', 'same-answer')
  await mkdir(entry, { recursive: true })
  await writeFile(join(entry, 'MANIFEST'), '{"branch":"work/same-answer"}')
  await writeFile(join(entry, 'state'), state)
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'same-answer'
  return repo.root
}

/** The settle world: a mergeable TASK whose branch has landed in main — one settle's whole
 *  given. The settle tears the world down, so each transport gets its own freshly built
 *  copy; the answers carry the TASK name only, never a path, so two copies answer alike. */
async function settleWorld(): Promise<string> {
  const repo = await makeGitRepo({ 'a.txt': 'a\n' })
  await enterTask(repo, 'same-answer', { edit: 'a.txt' })
  await repo.git(['merge', 'work/same-answer'])
  await repo.write('.proofspec/dispatch/same-answer/state', 'mergeable')
  // Named through the environment the way a dispatched session's environment names it: the
  // settle resolves its queue from PROOFSPEC_QUEUE_ROOT/PROOFSPEC_TASK, never from a
  // working directory — a cwd-named world would demand the exact fallback the settle
  // STANDARD refuses ("never from the session's own working directory"), making the
  // result limb unpassable for a conforming core.
  process.env.PROOFSPEC_QUEUE_ROOT = repo.root
  process.env.PROOFSPEC_TASK = 'same-answer'
  return repo.root
}

/** Carries one call through both transports, each against its own freshly built copy of one
 *  world — for calls with side effects, where the second copy must answer from the same
 *  starting point rather than from the first copy's residue. */
async function eachInItsOwnWorld(
  piTools: ReadonlyMap<string, RegisteredTool>,
  core: ToolCore,
  tool: ToolName,
  args: Record<string, unknown>,
  buildWorld: () => Promise<string>,
): Promise<readonly [Answer, Answer]> {
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
  const viaPi = await callThroughPi(piTools, tool, args, await buildWorld())

  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
  const server = await startMcp({ core, cwd: await buildWorld() })
  try {
    const viaMcp = await server.callTool(tool, args)
    return [viaPi, viaMcp]
  } finally {
    await server.close()
  }
}

/** Carries one call through both transports against the one world — for calls that leave the
 *  world as they found it, or that answer the same value however many times they run. */
async function bothInOneWorld(
  piTools: ReadonlyMap<string, RegisteredTool>,
  core: ToolCore,
  tool: ToolName,
  args: Record<string, unknown>,
  root: string,
): Promise<readonly [Answer, Answer]> {
  const viaPi = await callThroughPi(piTools, tool, args, root)
  const server = await startMcp({ core, cwd: root })
  try {
    const viaMcp = await server.callTool(tool, args)
    return [viaPi, viaMcp]
  } finally {
    await server.close()
  }
}

// --- the claims ------------------------------------------------------------------------

// Requirement: The MCP server exposes the same five tools, answering from one core
// Scenario: The server exposes the same five tools under the same names, and no others
// GIVEN the MCP server registered, and the pi extensions registered
// WHEN the tool names each transport exposes are read
// THEN both name exactly `enqueue_task`, `census_in_flight`, `report_task_state`, `report_task_phase`, and `settle_task` — no tool stands on one transport that does not stand on the other
it('exposes the same five tools under the same names on both transports, and no others', async () => {
  const piTools = registerPiTools()
  const server = await startMcp({})
  try {
    // Two set equalities against the requirement's own list, so a tool missing on one
    // transport, or standing on one alone, each fail on their own side.
    expect([...piTools.keys()].sort()).toEqual([...TOOLS].sort())
    expect(server.tools.map(tool => tool.name).sort()).toEqual([...TOOLS].sort())
  } finally {
    await server.close()
  }
})

// Requirement: The MCP server exposes the same five tools, answering from one core
// Scenario: Each tool is registered under the same parameters on both transports
// GIVEN the five tools registered on each transport
// WHEN one tool's parameters are compared across the two registrations
// THEN they match one-for-one — every parameter one names, the other names
it('registers each tool under the same parameters on both transports', async () => {
  const piTools = registerPiTools()
  const server = await startMcp({})
  try {
    for (const tool of TOOLS) {
      const pi = piTools.get(tool)
      const mcp = server.tools.find(registered => registered.name === tool)
      expect(pi, `${tool} on the pi transport`).toBeDefined()
      expect(mcp, `${tool} on the MCP server`).toBeDefined()
      if (pi === undefined || mcp === undefined) continue
      expect(parameterNames(mcp.inputSchema), `${tool} through the MCP server`).toEqual(parameterNames(pi.parameters))
      expect(requiredNames(mcp.inputSchema), `${tool} through the MCP server`).toEqual(requiredNames(pi.parameters))
    }
  } finally {
    await server.close()
  }
})

// Requirement: The MCP server exposes the same five tools, answering from one core
// Scenario: A tool answers the same values whichever transport carries its call
// GIVEN the same call to each of the five tools — one call the tool answers with a result, one it refuses
// WHEN one copy is carried by the pi extension and the other by the MCP server
// THEN the two answers are exactly the same value, for every tool, result and refusal alike
it('answers the same values whichever transport carries the call, for every tool', async () => {
  const core = createCore({ scheduleActions: {} })
  const piTools = registerPiTools(core)

  // enqueue_task — a fresh TASK queued (each transport against its own copy, the call
  // being a write), and a TASK name that is not a slug refused before anything is touched.
  {
    const queued = await eachInItsOwnWorld(piTools, core, 'enqueue_task', { task: 'same-answer', intentRef: 'docs/x.md', branch: 'work/same-answer' }, enqueueWorld)
    expect(queued[0].structured).toMatchObject({ ok: true })
    expect(queued[1], 'enqueue_task result').toEqual(queued[0])

    const refused = await bothInOneWorld(piTools, core, 'enqueue_task', { task: 'not a/slug', intentRef: 'docs/x.md', branch: 'work/anything' }, (await makeRepo({})).root)
    expect(refused[0].structured).toMatchObject({ ok: false })
    expect(refused[1], 'enqueue_task refusal').toEqual(refused[0])
  }

  // census_in_flight — a census with something to count, and a queue directory that cannot
  // be read at all. Both halves are reads, so one world carries both copies.
  {
    const counted = await bothInOneWorld(piTools, core, 'census_in_flight', {}, await censusWorld())
    expect(counted[0].structured).toMatchObject({ ok: true })
    expect(counted[1], 'census_in_flight result').toEqual(counted[0])

    const refused = await bothInOneWorld(piTools, core, 'census_in_flight', {}, await unreadableQueueWorld())
    expect(refused[0].structured).toMatchObject({ ok: false })
    expect(refused[1], 'census_in_flight refusal').toEqual(refused[0])
  }

  // report_task_state — building reported into a real entry (the second copy reports the
  // same word again and answers the same value), and a word outside the reportable set refused.
  {
    const reported = await bothInOneWorld(piTools, core, 'report_task_state', { state: 'building' }, await reportWorld('queued'))
    expect(reported[0].structured).toMatchObject({ ok: true })
    expect(reported[1], 'report_task_state result').toEqual(reported[0])

    const refused = await bothInOneWorld(piTools, core, 'report_task_state', { state: 'queued' }, await reportWorld('queued'))
    expect(refused[0].structured).toMatchObject({ ok: false })
    expect(refused[1], 'report_task_state refusal').toEqual(refused[0])
  }

  // report_task_phase — a word and round reported (the second copy finds the standing
  // already matching and answers the same value), and an empty word refused.
  {
    const reported = await bothInOneWorld(piTools, core, 'report_task_phase', { phase: 'explorer', round: 2 }, await reportWorld('building'))
    expect(reported[0].structured).toMatchObject({ ok: true })
    expect(reported[1], 'report_task_phase result').toEqual(reported[0])

    const refused = await bothInOneWorld(piTools, core, 'report_task_phase', { phase: '   ' }, await reportWorld('building'))
    expect(refused[0].structured).toMatchObject({ ok: false })
    expect(refused[1], 'report_task_phase refusal').toEqual(refused[0])
  }

  // settle_task — a mergeable, landed TASK settled (each transport against its own copy,
  // the settle being a teardown), and a TASK whose word is not mergeable refused untouched.
  {
    const settled = await eachInItsOwnWorld(piTools, core, 'settle_task', {}, settleWorld)
    expect(settled[0].structured).toMatchObject({ ok: true })
    expect(settled[1], 'settle_task result').toEqual(settled[0])

    const refused = await bothInOneWorld(piTools, core, 'settle_task', {}, await reportWorld('building'))
    expect(refused[0].structured).toMatchObject({ ok: false })
    expect(refused[1], 'settle_task refusal').toEqual(refused[0])
  }
}, 20_000)

// Requirement: The MCP server exposes the same five tools, answering from one core
// Scenario: A change to each tool's behavior reaches both transports together
// GIVEN each of the five tools in turn answering through both transports, and that tool's behavior then changed — the change made once
// WHEN the changed tool is called again through the pi extension and through the MCP server
// THEN both transports answer the changed way together, for every one of the five tools — the change cannot land in one transport's answers without landing in the other's, because that tool's rule is written nowhere else
it("answers the changed way on both transports together when one tool's rule changes once", async () => {
  for (const tool of TOOLS) {
    delete process.env.PROOFSPEC_QUEUE_ROOT
    delete process.env.PROOFSPEC_TASK
    const core = createCore({ scheduleActions: {} })
    const piTools = registerPiTools(core)
    const server = await startMcp({ core, cwd: (await makeRepo({})).root })
    try {
      const args = SAMPLE_ARGS[tool]
      const beforePi = await callThroughPi(piTools, tool, args, (await makeRepo({})).root)
      const beforeMcp = await server.callTool(tool, args)
      expect(beforeMcp, `${tool} before the change`).toEqual(beforePi)

      // The change, made once, on the one core both transports answer from. A second copy of
      // the rule hidden anywhere on the MCP side answers the old way and fails the pair below.
      core[tool] = async () => ({ ok: false, reason: 'changed once, in the core' })

      const afterPi = await callThroughPi(piTools, tool, args, (await makeRepo({})).root)
      const afterMcp = await server.callTool(tool, args)
      expect(afterMcp, `${tool} after the change`).toEqual(afterPi)
      expect(afterPi, `${tool} did not actually change`).not.toEqual(beforePi)
    } finally {
      await server.close()
    }
  }
}, 10_000)
