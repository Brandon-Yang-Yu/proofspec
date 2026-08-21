import { compareStrings } from '../order.ts'
import type {
  CallGraph,
  ChangedLines,
  GraphNode,
  ImpactNode,
  ImpactTree,
  TestReach,
} from './types.ts'

/**
 * What a change to the source reaches. `touched` starts at a changed test and reads down to
 * the promise it proves; this starts at a changed *function* and walks the call graph the
 * other way, until it meets the tests — which are the ones to review, and whose scenarios
 * name the promises to re-read.
 *
 * The graph is handed in. Where it comes from is `cli`'s problem, the same way running git
 * is: this walks a graph and nothing else, so a fixture and a real index are the same input.
 */
export function impactTree(input: {
  readonly changed: readonly ChangedLines[]
  readonly graph: CallGraph
  readonly depth: number
}): ImpactTree {
  const byId = new Map(input.graph.nodes.map(node => [node.id, node]))
  const callers = callersByCallee(input.graph, byId)

  const seeds = input.changed
    .flatMap(file => functionsAt(file, input.graph.nodes))
    .sort(compareNodes)

  // Every changed function is on the tree in its own right, so one that calls another shows
  // as repeated under it rather than being expanded a second time.
  const expanded = new Set(seeds.map(seed => seed.id))
  const walk = (node: GraphNode, depth: number): ImpactNode => ({
    kind: 'reached',
    fn: node,
    tests: testsCalling(node, callers),
    callers: depth <= 0 ? [] : codeCalling(node, callers).map(caller => step(caller, depth - 1)),
  })
  const step = (node: GraphNode, depth: number): ImpactNode => {
    if (expanded.has(node.id)) return { kind: 'repeated', fn: node }
    expanded.add(node.id)
    return walk(node, depth)
  }

  const placed = new Set(seeds.map(seed => seed.file))
  return {
    changed: seeds.map(seed => walk(seed, input.depth)),
    unmapped: input.changed.map(file => file.file).filter(file => !placed.has(file)),
  }
}

/** The functions a file's changed lines fall in. */
function functionsAt(changed: ChangedLines, nodes: readonly GraphNode[]): GraphNode[] {
  return nodes.filter(
    node =>
      node.file === changed.file &&
      // A file node spans every line in the file, so a change always overlaps it; placing the
      // change there would say "the whole file changed" and bury the function that did.
      node.kind === 'function' &&
      !node.isTest &&
      changed.ranges.some(range => range.from <= node.to && range.to >= node.from),
  )
}

/** Who calls each function, by the callee's id. */
type Callers = ReadonlyMap<string, readonly { readonly node: GraphNode; readonly line: number }[]>

function callersByCallee(graph: CallGraph, byId: ReadonlyMap<string, GraphNode>): Callers {
  const callers = new Map<string, { node: GraphNode; line: number }[]>()
  for (const call of graph.calls) {
    const caller = byId.get(call.caller)
    // A call whose caller is not a node the graph gave us has nothing to hang on the tree.
    if (caller === undefined || call.caller === call.callee) continue
    const held = callers.get(call.callee) ?? []
    held.push({ node: caller, line: call.line })
    callers.set(call.callee, held)
  }
  return callers
}

/**
 * The tests calling this function, one entry per test file: a file that calls it in ten
 * places is one file to review, not ten. The earliest call wins, so the entry points at the
 * first place the test reaches the change.
 */
function testsCalling(node: GraphNode, callers: Callers): TestReach[] {
  const byFile = new Map<string, number>()
  for (const caller of callers.get(node.id) ?? []) {
    if (!caller.node.isTest) continue
    const held = byFile.get(caller.node.file)
    if (held === undefined || caller.line < held) byFile.set(caller.node.file, caller.line)
  }
  return [...byFile]
    .map(([file, line]) => ({ file, line }))
    .sort((a, b) => compareStrings(a.file, b.file))
}

function codeCalling(node: GraphNode, callers: Callers): GraphNode[] {
  const seen = new Map<string, GraphNode>()
  for (const caller of callers.get(node.id) ?? []) {
    if (caller.node.isTest) continue
    seen.set(caller.node.id, caller.node)
  }
  return [...seen.values()].sort(compareNodes)
}

/** File then line, so the tree comes out the same however the graph listed its nodes. */
function compareNodes(a: GraphNode, b: GraphNode): number {
  return compareStrings(a.file, b.file) || a.from - b.from
}
