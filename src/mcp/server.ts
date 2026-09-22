import { answerText, createToolCore, TOOL_SURFACE } from './core.ts'
import type { ToolCore, ToolName } from './core.ts'

/**
 * The stdio MCP server (`specs/mcp.md`): serves the one core over newline-delimited JSON-RPC
 * on a stream pair — the wire protocol a Claude Code process speaks. This adapter carries
 * transport only: it answers every call by handing it to the core and returning the core's
 * answer, and decides nothing itself.
 */

/** The protocol version this server speaks — echoed back at initialize, as the protocol asks. */
const PROTOCOL_VERSION = '2025-06-18'

const SERVER_INFO = { name: 'proofspec', version: '0.1.0' }

const TOOL_NAMES: readonly ToolName[] = TOOL_SURFACE.map(tool => tool.name)

/**
 * The one carrying behind every `tools/call`: hand the named tool's arguments to the core,
 * answer exactly what the core produced. Injected with the core it delegates to, so a proof
 * can run it against a core whose answers are known in advance (`tests/mcp/adapter.test.ts`).
 */
export async function mcpCallTool(tool: string, args: Record<string, unknown>, core?: ToolCore, cwd?: string): Promise<unknown> {
  const resolved = core ?? createToolCore()
  return resolved.call(tool, args, cwd)
}

/** What one line off the wire parsed into, or nothing for a line that is not a message. */
type WireMessage = {
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
}

/** A message that is a request: it carries both a method to run and an id to answer. */
type WireRequest = { readonly id: unknown; readonly method: unknown; readonly params?: unknown }

/** The message as a request, or nothing when it is a notification or not a message at all. */
function requestFrom(message: WireMessage): WireRequest | undefined {
  const { id, method, params } = message
  if (id === undefined || method === undefined) return undefined
  return { id, method, params }
}

/** One wire line as a JSON-RPC message, or nothing for a line that is empty or not JSON. */
function parseMessage(line: string): WireMessage | undefined {
  if (line.trim() === '') return undefined
  try {
    return JSON.parse(line) as WireMessage
  } catch {
    return undefined
  }
}

/**
 * Serves the core over the given streams until closed. Every request is answered in order of
 * arrival; notifications (a request's counterpart carrying no id) are accepted and ignored.
 * The streams are the caller's — nothing here closes them, so a caller that owns the process's
 * own stdio keeps owning its exit.
 */
export function serveMcp(options: {
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  readonly core?: ToolCore
  readonly cwd?: string
}): { readonly close: () => Promise<void> } {
  const core = options.core ?? createToolCore()
  const cwd = options.cwd ?? process.cwd()
  let buffer = ''
  let closed = false

  const respond = (message: unknown): void => {
    options.output.write(`${JSON.stringify(message)}\n`)
  }

  const onData = (chunk: Buffer | string): void => {
    if (closed) return
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let newlineAt = buffer.indexOf('\n')
    while (newlineAt !== -1) {
      const line = buffer.slice(0, newlineAt)
      buffer = buffer.slice(newlineAt + 1)
      newlineAt = buffer.indexOf('\n')
      const message = parseMessage(line)
      if (message === undefined) continue
      const request = requestFrom(message)
      if (request === undefined) continue
      // Answered on a later turn of the event loop, never inside the caller's own write():
      // a client that writes a request and only then stands up its waiter must not be raced
      // by an answer delivered synchronously back through its own write call.
      setImmediate(() => {
        if (closed) return
        answer(request).catch(error => {
          respond({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: String(error) } })
        })
      })
    }
  }

  async function answer(request: WireRequest): Promise<void> {
    const { id } = request
    const method = typeof request.method === 'string' ? request.method : ''
    const params = (request.params ?? {}) as Record<string, unknown>
    if (method === 'initialize') {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION
      respond({ jsonrpc: '2.0', id, result: { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: SERVER_INFO } })
      return
    }
    if (method === 'tools/list') {
      respond({ jsonrpc: '2.0', id, result: { tools: TOOL_SURFACE.map(({ name, description, parameters }) => ({ name, description, inputSchema: parameters })) } })
      return
    }
    if (method === 'tools/call') {
      const name = typeof params.name === 'string' ? params.name : ''
      if (!(TOOL_NAMES as readonly string[]).includes(name)) {
        respond({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } })
        return
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const result = await mcpCallTool(name, args, core, cwd)
      const tool = name as ToolName
      respond({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: answerText(tool, result) }], structuredContent: result } })
      return
    }
    if (method === 'ping') {
      respond({ jsonrpc: '2.0', id, result: {} })
      return
    }
    respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  }

  options.input.on('data', onData)
  return {
    async close() {
      closed = true
      options.input.off('data', onData)
    },
  }
}