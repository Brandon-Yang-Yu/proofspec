/**
 * What impact is given and what it hands back. The graph arrives as plain values, so this
 * capability never learns where it came from — an indexer, a file, or a fixture all look
 * the same from here.
 */

import type { LineRange } from '../locate/index.ts'

/**
 * A node of a call graph: a function, or a whole file whose top-level code calls things.
 * The two are told apart because only a function can be *the thing that changed* — a file
 * node spans every line in it, so placing a change on one would say the whole file changed.
 * As a caller, both are ordinary: an entry script calls just like a function does.
 */
export type GraphNode = {
  /** Whatever the graph calls this node, unique within it. */
  readonly id: string
  readonly name: string
  readonly kind: 'function' | 'file'
  readonly file: string
  readonly from: number
  readonly to: number
  /** Whether it is a test. Whoever builds the graph decides; the walk only reads it. */
  readonly isTest: boolean
}

/** One call, and the line it is written on. */
export type CallEdge = {
  readonly caller: string
  readonly callee: string
  readonly line: number
}

export type CallGraph = {
  readonly nodes: readonly GraphNode[]
  readonly calls: readonly CallEdge[]
}

/** The lines that changed in one source file. */
export type ChangedLines = {
  readonly file: string
  readonly ranges: readonly LineRange[]
}

/** A test that calls a function on the tree, and the line it calls from. */
export type TestReach = {
  readonly file: string
  readonly line: number
}

/**
 * One function on the tree. `repeated` is a function shown elsewhere already: its callers
 * are not walked again, which is what ends a cycle and what keeps one subtree from being
 * printed twice. A union rather than a flag, so a reader cannot look for callers on a node
 * that has none to give.
 */
export type ImpactNode =
  | {
      readonly kind: 'reached'
      readonly fn: GraphNode
      /** Tests that call this function directly. */
      readonly tests: readonly TestReach[]
      /** What calls it, one level up. */
      readonly callers: readonly ImpactNode[]
    }
  | {
      readonly kind: 'repeated'
      readonly fn: GraphNode
    }

export type ImpactTree = {
  /** The changed functions, each with everything that reaches it. */
  readonly changed: readonly ImpactNode[]
  /** Changed files holding no function the graph knows: an entry script, or one not indexed. */
  readonly unmapped: readonly string[]
}
