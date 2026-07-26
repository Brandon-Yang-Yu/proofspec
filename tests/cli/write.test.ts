// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check, write } from '../../src/cli/index.ts'
import { CAPABILITY, REQUIREMENT, TEST_PATH, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

const SCENARIOS = ['A first behavior', 'A second behavior']

/** A test file the scan cannot read: an AND sits where a step keyword belongs. */
function unreadableTest(): string {
  return [
    `// Capability: ${CAPABILITY}`,
    '',
    `// Requirement: ${REQUIREMENT}`,
    '// Scenario: A first behavior',
    '// WHEN something happens',
    '// AND another thing happens',
    '// THEN the demonstrated claim holds',
    "it('a first behavior', () => {",
    '  expect(true).toBe(true)',
    '})',
  ].join('\n')
}

// Requirement: Writing back records the tests in the committed files
// Scenario: Writing back records a scenario the tests prove but the file did not
// GIVEN a repo whose committed file omits a scenario the tests prove
// WHEN the write runs
// THEN the file on disk records the missing scenario, and a following check passes
it('records a proven scenario the committed file was missing', async () => {
  const specPath = `specs/${CAPABILITY}.md`
  const repo = await makeRepo({
    [specPath]: specFile({ recorded: ['A first behavior'] }),
    [TEST_PATH]: testFile(SCENARIOS),
  })

  await write({ cwd: repo.root })

  expect(await repo.read(specPath)).toBe(specFile({ recorded: SCENARIOS }))
  const outcome = await check({ cwd: repo.root })
  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})

// Requirement: Writing back records the tests in the committed files
// Scenario: Writing back a repo already in agreement changes no file
// GIVEN a repo whose committed file already records exactly what the tests prove
// WHEN the write runs
// THEN no file's bytes change, so the write-back is safe to run when nothing has moved
it('changes no file when the committed file already agrees', async () => {
  const specPath = `specs/${CAPABILITY}.md`
  const before = {
    [specPath]: specFile({ recorded: SCENARIOS }),
    [TEST_PATH]: testFile(SCENARIOS),
  }
  const repo = await makeRepo(before)

  await write({ cwd: repo.root })

  expect(await repo.read(specPath)).toBe(before[specPath])
  expect(await repo.read(TEST_PATH)).toBe(before[TEST_PATH])
})

// Requirement: Writing back records the tests in the committed files
// Scenario: Writing back leaves the other capability files untouched
// GIVEN a repo with two capability files, one that has drifted and one already in agreement
// WHEN the write runs and records the drifted one
// THEN the file it did not need to change is byte-for-byte what it was, so "changes nothing
//      else" holds across files and not only within the one it rewrote
it('leaves a capability file it need not change untouched', async () => {
  const drifted = `specs/${CAPABILITY}.md`
  const settled = 'specs/other.md'
  const otherTags = { capability: 'other', requirement: 'Another promise' }
  const otherTestPath = 'tests/other.test.ts'
  const settledBefore = specFile({ recorded: ['The other behavior'], testPath: otherTestPath, ...otherTags })
  const repo = await makeRepo({
    [drifted]: specFile({ recorded: ['A first behavior'] }),
    [TEST_PATH]: testFile(SCENARIOS),
    [settled]: settledBefore,
    [otherTestPath]: testFile(['The other behavior'], otherTags),
  })

  const outcome = await write({ cwd: repo.root })

  expect(outcome).toEqual({ kind: 'wrote', files: [drifted] })
  expect(await repo.read(settled)).toBe(settledBefore)
})

// Requirement: Writing back records the tests in the committed files
// Scenario: Writing back a repo it cannot fully read changes nothing
// GIVEN a repo holding a test the scan cannot read
// WHEN the write runs
// THEN it refuses, reporting it cannot run, and no file's bytes change — a command that
//      writes must not act on a tree built from tests it could not fully read
it('refuses and changes nothing when a test cannot be read', async () => {
  const specPath = `specs/${CAPABILITY}.md`
  const before = {
    [specPath]: specFile({ recorded: [] }),
    [TEST_PATH]: unreadableTest(),
  }
  const repo = await makeRepo(before)

  const outcome = await write({ cwd: repo.root })

  expect(outcome.kind).toBe('cannot-run')
  expect(await repo.read(specPath)).toBe(before[specPath])
})
