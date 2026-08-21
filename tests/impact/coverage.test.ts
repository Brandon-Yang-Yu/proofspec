// Capability: impact

import { expect, it } from 'vitest'
import { functionsRun, testsRunning } from '../../src/impact/index.ts'
import type { TestRun } from '../../src/impact/index.ts'
import { FILE, node } from './support.ts'

/** Counter ids to function names, as a coverage report carries them. */
const NAMES = { '0': 'edited', '1': 'other', '2': 'untouched' }

/** A test run record as the collector writes one. */
function run(fields: { readonly line: number; readonly file?: string; readonly ran: Record<string, readonly string[]> }): TestRun {
  return {
    file: fields.file ?? 'tests/example.test.ts',
    line: fields.line,
    ran: Object.entries(fields.ran).map(([file, names]) => ({ file, names })),
  }
}

// Requirement: A test's own coverage is the counters that moved while it ran
// Scenario: A counter that went up while the test ran names a function it executed
// GIVEN a snapshot before a test and one after, with one counter higher
// WHEN the functions the test ran are read
// THEN that function is named, which is the whole of what this test executed
it('names the function whose counter went up while the test ran', () => {
  const ran = functionsRun({
    before: { '0': 3, '1': 0, '2': 7 },
    after: { '0': 4, '1': 0, '2': 7 },
    names: NAMES,
  })

  expect(ran).toEqual(['edited'])
})

// Requirement: A test's own coverage is the counters that moved while it ran
// Scenario: A counter the test never moved is not named however high it stands
// GIVEN a counter already at seven before the test and still at seven after
// WHEN the functions the test ran are read
// THEN it is not named, because coverage counters are cumulative: a high count is what
//      earlier tests did, and reading it straight would say every test runs everything
it('does not name a function whose counter stood still, however high', () => {
  const ran = functionsRun({
    before: { '0': 0, '2': 7 },
    after: { '0': 1, '2': 7 },
    names: NAMES,
  })

  expect(ran).toEqual(['edited'])
})

// Requirement: The tests that ran a changed function are named from coverage
// Scenario: A test that ran a changed function is named
// GIVEN a changed function and a test that ran it
// WHEN the tests that ran the change are read
// THEN that test is named with the line it opens on, which is where its scenario is written
it('names a test that ran the changed function', () => {
  const edited = node('edited', { from: 20, to: 30 })

  const reached = testsRunning({
    functions: [edited],
    runs: [run({ line: 42, ran: { [FILE]: ['edited', 'other'] } })],
  })

  expect(reached).toEqual([{ file: 'tests/example.test.ts', line: 42 }])
})

// Requirement: The tests that ran a changed function are named from coverage
// Scenario: A test that ran only other functions is not named
// GIVEN a test that ran functions of the same file, but not the changed one
// WHEN the tests that ran the change are read
// THEN it is not named: reaching the file is what the call graph already says, and the
//      point of coverage is to say which tests actually ran the change
it('leaves out a test that ran only other functions', () => {
  const edited = node('edited', { from: 20, to: 30 })

  const reached = testsRunning({
    functions: [edited],
    runs: [run({ line: 42, ran: { [FILE]: ['other', 'untouched'] } })],
  })

  expect(reached).toEqual([])
})

// Requirement: The tests that ran a changed function are named from coverage
// Scenario: A function of the same name in another file is not a match
// GIVEN a test that ran a function named like the changed one, in a different file
// WHEN the tests that ran the change are read
// THEN it is not named, because a name alone is not an identity: two files may each hold a
//      `render` and only one of them changed
it('does not match a function of the same name in another file', () => {
  const edited = node('edited', { file: 'src/one.ts', from: 20, to: 30 })

  const reached = testsRunning({
    functions: [edited],
    runs: [run({ line: 42, ran: { 'src/two.ts': ['edited'] } })],
  })

  expect(reached).toEqual([])
})
