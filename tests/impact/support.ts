import type { CallEdge, GraphNode } from '../../src/impact/index.ts'

/**
 * `impact` is given a call graph as plain values, so its fixtures are plain values too:
 * a node is a function somewhere in a file, and an edge is one calling another. Nothing
 * here knows where a real graph comes from, which is the point — the capability walks a
 * graph, it does not fetch one.
 */

/** Where a fixture function lives unless a test varies it to make its point. */
export const FILE = 'src/example.ts'

export function node(
  name: string,
  at: {
    readonly file?: string
    readonly from?: number
    readonly to?: number
    readonly isTest?: boolean
    readonly kind?: 'function' | 'file'
  } = {},
): GraphNode {
  const from = at.from ?? 1
  return {
    id: name,
    name,
    kind: at.kind ?? 'function',
    file: at.file ?? FILE,
    from,
    to: at.to ?? from + 4,
    isTest: at.isTest ?? false,
  }
}

/** A test file: to the graph a test is the file itself, whose top-level code does the calling. */
export function testNode(file: string): GraphNode {
  return node(file, { file, isTest: true, kind: 'file', from: 1, to: 999 })
}

export function calls(caller: GraphNode, callee: GraphNode, line = 1): CallEdge {
  return { caller: caller.id, callee: callee.id, line }
}
