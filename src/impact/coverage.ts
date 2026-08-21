import { compareStrings } from '../order.ts'
import type { GraphNode, TestReach, TestRun } from './types.ts'

/**
 * What a change reaches according to a real test run, rather than according to the call
 * graph. The graph says a test *can* reach a function; coverage says a test *did*.
 *
 * The two answer different halves of one question, so both are kept: the graph explains the
 * path — which functions the call travels through — and coverage confirms it was travelled.
 */

/**
 * The functions a single test ran, read as the difference between two counter snapshots.
 *
 * Coverage counters are cumulative: by the tenth test they hold what the first nine did too,
 * so a counter's height says nothing about the test that just finished. Only a counter that
 * moved while it ran belongs to it.
 */
export function functionsRun(input: {
  readonly before: Readonly<Record<string, number>>
  readonly after: Readonly<Record<string, number>>
  /** Counter id to function name, as the coverage report carries it. */
  readonly names: Readonly<Record<string, string>>
}): readonly string[] {
  const ran = new Set<string>()
  for (const [id, count] of Object.entries(input.after)) {
    if (count <= (input.before[id] ?? 0)) continue
    const name = input.names[id]
    if (name !== undefined) ran.add(name)
  }
  return [...ran].sort(compareStrings)
}

/**
 * The tests that ran one of the changed functions. Matched on file and name together: a name
 * alone is not an identity, since two files may each hold a `render` and only one changed.
 */
export function testsRunning(input: {
  readonly functions: readonly GraphNode[]
  readonly runs: readonly TestRun[]
}): readonly TestReach[] {
  const wanted = new Set(input.functions.map(fn => key(fn.file, fn.name)))
  return input.runs
    .filter(run => run.ran.some(file => file.names.some(name => wanted.has(key(file.file, name)))))
    .map(run => ({ file: run.file, line: run.line }))
    .sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line)
}

function key(file: string, name: string): string {
  return `${file} ${name}`
}
