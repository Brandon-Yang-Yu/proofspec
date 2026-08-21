import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CallEdge, CallGraph, GraphNode } from '../impact/index.ts'

const run = promisify(execFile)

/**
 * Where a call graph comes from. `impact` walks a graph and does not fetch one, so fetching
 * is here, beside the other process boundary `cli` owns.
 *
 * The graph is read from the codebase-memory index by running its CLI — the same way `touched`
 * runs git — or from a JSON file when one is named. The file is what a test uses, since a
 * unit test cannot index a repository, and what a person uses to feed in a graph from
 * anywhere else.
 */

export type GraphRead =
  | { readonly ok: true; readonly graph: CallGraph }
  | { readonly ok: false; readonly reason: string }

// Modules are in this query, not only functions: a test file calls through its top-level
// code, so the node on the other end of a test's CALLS edge is the module, not a function.
// Dropping them was what left every test off the tree.
const NODES_QUERY =
  'MATCH (f) WHERE (f:Function OR f:Method OR f:Module) RETURN f.qualified_name, f.name, f.file_path, f.start_line, f.end_line, labels(f)'
const CALLS_QUERY = 'MATCH (a)-[c:CALLS]->(b) RETURN a.qualified_name, b.qualified_name, c.line'

export async function readCallGraph(options: {
  readonly cwd: string
  readonly testsDir: string
  readonly project: string | undefined
  readonly from: string | undefined
}): Promise<GraphRead> {
  if (options.from !== undefined) return await readGraphFile(resolve(options.cwd, options.from))

  const project = options.project ?? projectNameOf(options.cwd)
  const nodes = await ask(project, NODES_QUERY)
  if (nodes === undefined) return { ok: false, reason: cannotAsk(project, options.cwd) }
  const calls = await ask(project, CALLS_QUERY)
  if (calls === undefined) return { ok: false, reason: cannotAsk(project, options.cwd) }
  if (nodes.length === 0) return { ok: false, reason: cannotAsk(project, options.cwd) }

  return {
    ok: true,
    graph: { nodes: nodes.map(row => toNode(row, options.testsDir)), calls: calls.map(toCall) },
  }
}

/**
 * The index names a project after its path, with the separators flattened — the name the
 * indexer itself derives, so the default works in a repo that was indexed the ordinary way.
 */
function projectNameOf(cwd: string): string {
  return cwd.replace(/^\//, '').replaceAll('/', '-')
}

function cannotAsk(project: string, cwd: string): string {
  return `no call graph for ${project}; index it first: codebase-memory-mcp cli index_repository --repo-path ${cwd}`
}

/** The indexer's rows, or `undefined` when it could not be run or answered nothing readable. */
async function ask(project: string, query: string): Promise<string[][] | undefined> {
  const binary = process.env.CODEBASE_MEMORY_BIN ?? `${homedir()}/.local/bin/codebase-memory-mcp`
  try {
    const { stdout } = await run(binary, ['cli', 'query_graph', '--project', project, '--query', query], {
      maxBuffer: MAX_OUTPUT,
    })
    // The binary logs to stdout before its answer, so the answer is the last JSON line.
    const answer = stdout.split('\n').filter(line => line.startsWith('{')).at(-1)
    if (answer === undefined) return undefined
    const parsed: unknown = JSON.parse(answer)
    return rowsOf(parsed)
  } catch {
    return undefined
  }
}

// A whole project's functions and calls have to fit; the default 1MB does not hold a large one.
const MAX_OUTPUT = 256 * 1024 * 1024

function rowsOf(parsed: unknown): string[][] | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('rows' in parsed)) return undefined
  const rows = (parsed as { rows: unknown }).rows
  if (!Array.isArray(rows)) return undefined
  return rows.map(row => (Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []))
}

/**
 * The index's `is_test` marks a test file's module but not the functions inside it, so a
 * helper in a test file would read as source. The tests directory is what `cli` already knows
 * a test by, so that is what decides it here — one rule, and the same one the rest of the
 * tool uses.
 */
function toNode(row: readonly string[], testsDir: string): GraphNode {
  const [id, name, file, from, to, labels] = row
  const path = file ?? ''
  return {
    id: id ?? '',
    name: name ?? '',
    kind: (labels ?? '').includes('Module') ? 'file' : 'function',
    file: path,
    from: Number(from ?? 0),
    to: Number(to ?? 0),
    isTest: path === testsDir || path.startsWith(`${testsDir}/`),
  }
}

function toCall(row: readonly string[]): CallEdge {
  const [caller, callee, line] = row
  return { caller: caller ?? '', callee: callee ?? '', line: Number(line ?? 0) }
}

/**
 * A graph read from a file. Parsed once here, at the boundary, so nothing downstream takes
 * `unknown` — a file that is not a graph is a reason, not a crash halfway through the walk.
 */
async function readGraphFile(path: string): Promise<GraphRead> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return { ok: false, reason: `${path} could not be read as a call graph` }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: notAGraph(path) }
  const { nodes, calls } = parsed as { nodes?: unknown; calls?: unknown }
  if (!Array.isArray(nodes) || !Array.isArray(calls)) return { ok: false, reason: notAGraph(path) }
  return {
    ok: true,
    graph: {
      nodes: nodes.map((node: Record<string, unknown>) => ({
        id: String(node.id ?? ''),
        name: String(node.name ?? ''),
        kind: node.kind === 'file' ? ('file' as const) : ('function' as const),
        file: String(node.file ?? ''),
        from: Number(node.from ?? 0),
        to: Number(node.to ?? 0),
        isTest: node.isTest === true,
      })),
      calls: calls.map((call: Record<string, unknown>) => ({
        caller: String(call.caller ?? ''),
        callee: String(call.callee ?? ''),
        line: Number(call.line ?? 0),
      })),
    },
  }
}

function notAGraph(path: string): string {
  return `${path} is not a call graph: expected { nodes: [...], calls: [...] }`
}
