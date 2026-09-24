// Capability: cli

import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { check } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeRepo, REQUIREMENT, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

const SCENARIOS = ['A first behavior', 'A second behavior']

/**
 * A proof file spelled `.test.tsx` whose it bodies hold real JSX, so a discovery that found
 * the file but a scan that could not parse TSX would still fail the check that reads it.
 */
function tsxTestFile(scenarios: readonly string[]): string {
  const blocks = scenarios.map(scenario =>
    [
      `// Requirement: ${REQUIREMENT}`,
      `// Scenario: ${scenario}`,
      `// THEN the demonstrated claim holds`,
      `it(${JSON.stringify(scenario)}, () => {`,
      `  const node = <button type="button">{${JSON.stringify(scenario)}}</button>`,
      `  expect(node.props.type).toBe('button')`,
      `})`,
    ].join('\n'),
  )
  return [`// Capability: ${CAPABILITY}`, '', ...blocks].join('\n')
}

// Requirement: It runs in a conventional repo with no configuration
// Scenario: The conventional layout is checked with no locations given
// GIVEN a repo keeping its CAPABILITY_FILE in specs/ and its tests in tests/
// WHEN the check runs with no locations given
// THEN it reads both from the conventional places and returns a verdict
it('checks the conventional layout with no locations given', async () => {
  const repo = await makeRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: SCENARIOS }),
    'tests/demo.test.ts': testFile(SCENARIOS),
  })

  const outcome = await check({ cwd: repo.root })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})

// Requirement: It runs in a conventional repo with no configuration
// Scenario: Both locations can be pointed at where a repo keeps them
// GIVEN a repo keeping its CAPABILITY_FILE under docs/spec and its tests under test
// WHEN the check runs with both locations given
// THEN it reads them from there and returns a verdict, which it could only do by honouring
//      the given locations rather than the conventional ones
it('checks a repo whose files sit in unconventional places', async () => {
  const testPath = 'test/demo.test.ts'
  const repo = await makeRepo({
    [`docs/spec/${CAPABILITY}.md`]: specFile({ recorded: SCENARIOS, testPath }),
    [testPath]: testFile(SCENARIOS),
  })

  const outcome = await check({ cwd: repo.root, specsDir: 'docs/spec', testsDir: 'test' })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})

// Requirement: It runs in a conventional repo with no configuration
// Scenario: Component suites named .test.tsx are discovered like any other test
// GIVEN a repo whose recorded proofs live in a .test.tsx file holding JSX, under tests/
// WHEN the check runs on the conventional layout
// THEN the verdict is agreement, which it could only reach by discovering and parsing the
//      .test.tsx file — a discovery that skipped it would report the recorded scenarios
//      as declared but never proven
it('checks a repo whose proofs sit in a discovered .test.tsx file', async () => {
  const testPath = 'tests/demo.test.tsx'
  const repo = await makeRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: SCENARIOS, testPath }),
    [testPath]: tsxTestFile(SCENARIOS),
  })

  const outcome = await check({ cwd: repo.root })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})

// Requirement: It runs in a conventional repo with no configuration
// Scenario: Locations given as absolute paths are read from exactly there
// GIVEN a repo keeping both halves in unconventional places the defaults would never find
// WHEN the check runs with both locations given as absolute paths
// THEN it reads them from exactly there and the verdict is agreement, which neither the
//      glued-on path a concatenation would build nor the ignored-option defaults could give
it('checks a repo whose locations are given as absolute paths', async () => {
  const testPath = 'checks/demo.test.ts'
  const repo = await makeRepo({
    [`notes/${CAPABILITY}.md`]: specFile({ recorded: SCENARIOS, testPath }),
    [testPath]: testFile(SCENARIOS),
  })

  const outcome = await check({
    cwd: repo.root,
    specsDir: join(repo.root, 'notes'),
    testsDir: join(repo.root, 'checks'),
  })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})

// Requirement: It runs in a conventional repo with no configuration
// Scenario: Tests given by the caller are read as they stand
// GIVEN a repo whose recorded tests live under src/ui in .test.tsx files, with a test under tests/ the caller does not give
// WHEN the check runs with those files given rather than a testsDir
// THEN the verdict agrees with exactly the files given, which it could only do by standing
//      the given tests in for discovery — a check that read tests/ too would report the
//      ungiven test as drift, and this repo's verdict says pass
it('checks a repo whose tests are given rather than discovered', async () => {
  const testPath = 'src/ui/demo.test.tsx'
  const repo = await makeRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: SCENARIOS, testPath }),
    [testPath]: testFile(SCENARIOS),
    // A test discovery would read but the caller does not give: if the check stood the
    // given files beside discovery rather than in place of it, this scenario would be drift.
    'tests/demo.test.ts': testFile(['An ungiven behavior']),
  })

  const outcome = await check({
    cwd: repo.root,
    tests: { roots: ['src/ui'], files: [{ path: testPath, source: await repo.read(testPath) }] },
  })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('pass')
})
