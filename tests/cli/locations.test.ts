// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

const SCENARIOS = ['A first behavior', 'A second behavior']

// Requirement: It runs in a conventional repo with no configuration
// Scenario: The conventional layout is checked with no locations given
// GIVEN a repo keeping its capability files in specs/ and its tests in tests/
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
// GIVEN a repo keeping its capability files under docs/spec and its tests under test
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
