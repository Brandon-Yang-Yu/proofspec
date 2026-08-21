// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { exitCodeOf, impact } from '../../src/cli/index.ts'
import type { ImpactReport, Outcome } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, REQUIREMENT, specFile, testFile, TEST_PATH } from './support.ts'

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'
const SOURCE = 'src/thing.ts'
const GRAPH = 'graph.json'

/**
 * A graph shaped like the real one: a source function, another calling it, and the test file
 * calling that. The test reaches the change two hops away, which is the case worth proving —
 * one hop would pass even if the walk never recursed.
 */
const graph = JSON.stringify({
  nodes: [
    { id: 'thing', name: 'thing', kind: 'function', file: SOURCE, from: 1, to: 5, isTest: false },
    { id: 'caller', name: 'caller', kind: 'function', file: 'src/caller.ts', from: 1, to: 5, isTest: false },
    { id: 'proof', name: 'demo.test', kind: 'file', file: TEST_PATH, from: 1, to: 20, isTest: true },
  ],
  calls: [
    { caller: 'caller', callee: 'thing', line: 3 },
    { caller: 'proof', callee: 'caller', line: 6 },
  ],
})

function repoFiles(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: testFile([FIRST, SECOND]),
    [SOURCE]: 'export function thing() {\n  return 1\n}\n',
    'src/caller.ts': "import { thing } from './thing.ts'\nexport function caller() {\n  return thing()\n}\n",
    [GRAPH]: graph,
  }
}

function reportOf(outcome: Outcome): ImpactReport {
  if (outcome.kind !== 'impact') throw new Error(`expected an impact report, got ${outcome.kind}`)
  return outcome.report
}

// Requirement: A command walks from changed source to the tests that reach it
// Scenario: A changed function's tree names the tests that reach it and what they prove
// GIVEN a changed source function, a function calling it, and a test calling that one
// WHEN the impact command runs against a given call graph
// THEN the tree is rooted at the changed function with its caller above it, the test hangs
//      off the caller it actually calls, and the requirement that test proves is named with
//      the line of the capability file it is written on
it('walks from a changed function to the tests that reach it and the promises they prove', async () => {
  const repo = await makeGitRepo(repoFiles())
  await repo.write(SOURCE, 'export function thing() {\n  return 2\n}\n')

  const report = reportOf(await impact({ cwd: repo.root, graph: GRAPH }))

  const [root] = report.changed
  expect(root?.fn.name).toBe('thing')
  const [caller] = root?.kind === 'reached' ? root.callers : []
  expect(caller?.fn.name).toBe('caller')
  expect(caller?.kind === 'reached' ? caller.tests : []).toEqual([{ file: TEST_PATH, line: 6 }])
  expect(report.proves).toEqual([
    {
      file: TEST_PATH,
      requirements: [
        {
          capability: CAPABILITY,
          requirement: REQUIREMENT,
          spec: { file: `specs/${CAPABILITY}.md`, line: 3 },
          scenarios: [FIRST, SECOND],
        },
      ],
    },
  ])
})

// Requirement: A command walks from changed source to the tests that reach it
// Scenario: A change to the tests is not on this tree
// GIVEN a branch whose only change is to a test file
// WHEN the impact command runs
// THEN nothing is on the tree, because a changed test is the question `touched` answers and
//      answering it twice would say the same thing two ways
it('leaves a changed test to the touched command', async () => {
  const repo = await makeGitRepo(repoFiles())
  await repo.write(TEST_PATH, testFile([FIRST]))

  const report = reportOf(await impact({ cwd: repo.root, graph: GRAPH }))

  expect(report.changed).toEqual([])
  expect(report.unmapped).toEqual([])
})

// Requirement: A command walks from changed source to the tests that reach it
// Scenario: A changed file the graph knows no function in is reported unmapped
// GIVEN a changed source file the given graph holds no function for
// WHEN the impact command runs
// THEN the file is named as unmapped rather than dropped, so "I could not place this change"
//      is told apart from "this change reaches nothing"
it('names a changed file it could place no function in', async () => {
  const repo = await makeGitRepo(repoFiles())
  await repo.write('src/loose.ts', 'export const loose = 1\n')

  const report = reportOf(await impact({ cwd: repo.root, graph: GRAPH }))

  expect(report.changed).toEqual([])
  expect(report.unmapped).toEqual(['src/loose.ts'])
})

// Requirement: A command walks from changed source to the tests that reach it
// Scenario: A graph that cannot be read is a cannot-run
// GIVEN a run pointed at a graph file that is not there
// WHEN the impact command runs
// THEN it is cannot-run with a reason naming the file, so a missing graph cannot be read as
//      a change that reaches nothing
it('reports cannot-run when the graph cannot be read', async () => {
  const repo = await makeGitRepo(repoFiles())
  await repo.write(SOURCE, 'export function thing() {\n  return 2\n}\n')

  const outcome = await impact({ cwd: repo.root, graph: 'nowhere.json' })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
})

// Requirement: A command walks from changed source to the tests that reach it
// Scenario: Whatever it reaches, the command exits zero
// GIVEN a change that reaches a test
// WHEN the impact command runs and its exit code is taken
// THEN it is zero, because the tree is a report for a reviewer to read, not a verdict — the
//      command that fails a build is the check
it('exits zero whatever the change reaches', async () => {
  const repo = await makeGitRepo(repoFiles())
  await repo.write(SOURCE, 'export function thing() {\n  return 2\n}\n')

  const outcome = await impact({ cwd: repo.root, graph: GRAPH })

  expect(reportOf(outcome).changed).toHaveLength(1)
  expect(exitCodeOf(outcome)).toBe(0)
})
