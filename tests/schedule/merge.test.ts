// Capability: schedule

import { expect, it } from 'vitest'
import { tasksToMerge } from '../../src/schedule/index.ts'

/** Every branch reported as landed unless named otherwise — the ancestry answer git owns,
 *  handed in so the two-condition rule itself can be proven without a repository. */
function landed(except: readonly string[] = []): (branch: string) => Promise<boolean> {
  return async branch => !except.includes(branch)
}

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A mergeable TASK whose branch has landed in main is named for settling
// GIVEN a TASK whose state word is mergeable, and whose branch is an ancestor of main
// WHEN the pass decides which TASKs it settles this pass
// THEN that TASK is named for settling
it('names a mergeable TASK whose branch has landed in main for settling', async () => {
  const settled = await tasksToMerge([{ task: 'a', word: 'mergeable', branch: 'work/a' }], landed())

  expect(settled).toEqual(['a'])
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A mergeable TASK whose branch has not landed in main is not named for settling
// GIVEN a TASK whose state word is mergeable, but whose branch is not an ancestor of main
// WHEN the pass decides which TASKs it settles this pass
// THEN that TASK is not named, and its state word is left to keep standing
it('does not name a mergeable TASK whose branch has not landed in main', async () => {
  const settled = await tasksToMerge([{ task: 'a', word: 'mergeable', branch: 'work/a' }], landed(['work/a']))

  expect(settled).toEqual([])
})

// Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main
// Scenario: A landed branch alone does not settle a TASK whose word is not mergeable
// GIVEN a TASK whose branch is an ancestor of main, but whose state word is building, not mergeable
// WHEN the pass decides which TASKs it settles this pass
// THEN that TASK is not named — ancestry alone is never enough
it('does not settle a landed TASK whose word is not mergeable', async () => {
  const settled = await tasksToMerge([{ task: 'a', word: 'building', branch: 'work/a' }], landed())

  expect(settled).toEqual([])
})
