// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check, exitCodeOf } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

/** A repo whose committed file records exactly the scenarios its tests prove. */
function agreeing(): Readonly<Record<string, string>> {
  const scenarios = ['A first behavior', 'A second behavior']
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: scenarios }),
    'tests/demo.test.ts': testFile(scenarios),
  }
}

/** A repo proving a scenario its committed file does not record. */
function drifting(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: ['A first behavior'] }),
    'tests/demo.test.ts': testFile(['A first behavior', 'A second behavior']),
  }
}

// Requirement: The exit code says what happened
// Scenario: Agreement between the tests and the committed files exits zero
// GIVEN a repo whose committed file records exactly the scenarios the tests prove
// WHEN the check runs
// THEN its exit code is zero
it('exits zero when the tests and the committed files agree', async () => {
  const repo = await makeRepo(agreeing())

  const outcome = await check({ cwd: repo.root })

  expect(exitCodeOf(outcome)).toBe(0)
})

// Requirement: The exit code says what happened
// Scenario: Drift between the tests and the committed files exits non-zero
// GIVEN a repo proving a scenario its committed file does not record
// WHEN the check runs
// THEN its exit code is not zero
it('exits non-zero when the tests and the committed files disagree', async () => {
  const repo = await makeRepo(drifting())

  const outcome = await check({ cwd: repo.root })

  expect(exitCodeOf(outcome)).not.toBe(0)
})

// Requirement: The exit code says what happened
// Scenario: A repo the check cannot run in exits with a code that is not the drift code
// GIVEN a repo whose capability files are pointed at a directory that does not exist
// WHEN the check runs there, and separately in a repo that has merely drifted
// THEN the cannot-run exit code is non-zero and different from the drift code, so CI can
//      tell "your spec is wrong" apart from "I could not run"
it('exits with a code that is neither zero nor the drift code when it cannot run', async () => {
  const unreadable = await makeRepo({ 'tests/demo.test.ts': testFile(['A first behavior']) })
  const drifted = await makeRepo(drifting())

  const cannotRun = await check({ cwd: unreadable.root, specsDir: 'nowhere' })
  const drift = await check({ cwd: drifted.root })

  const cannotRunCode = exitCodeOf(cannotRun)
  expect(cannotRun.kind).toBe('cannot-run')
  expect(cannotRunCode).not.toBe(0)
  expect(cannotRunCode).not.toBe(exitCodeOf(drift))
})
