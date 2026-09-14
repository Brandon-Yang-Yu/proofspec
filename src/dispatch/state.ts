import type { TaskState } from './types.ts'

const MERGED = 'merged'

/**
 * Reads a TASK's state word literally: the one word this tool knows as done, and everything
 * else — including a word never seen before — as still in flight. A future word this capability
 * has never met is exactly the case a silent default would get wrong the other way: a TASK
 * wrongly dropped costs the graph its whole purpose, a TASK wrongly kept costs a reader a
 * moment's confusion.
 */
export function stateOf(word: string): TaskState {
  return word === MERGED ? 'merged' : 'in-flight'
}
