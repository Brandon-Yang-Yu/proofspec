// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check } from '../../src/cli/index.ts'
import { CAPABILITY, TEST_PATH, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

// Requirement: Checking never writes
// Scenario: A check that finds drift changes no file on disk
// GIVEN a repo whose committed capability file records fewer scenarios than the tests prove
// WHEN the check runs and finds the drift
// THEN the build fails and every file is byte-for-byte what it was before the check ran
it('changes no file even when it finds drift', async () => {
  const specPath = `specs/${CAPABILITY}.md`
  const before = {
    [specPath]: specFile({ recorded: ['A first behavior'] }),
    [TEST_PATH]: testFile(['A first behavior', 'A second behavior']),
  }
  const repo = await makeRepo(before)

  const outcome = await check({ cwd: repo.root })

  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  expect(outcome.report.status).toBe('fail')
  expect(await repo.read(specPath)).toBe(before[specPath])
  expect(await repo.read(TEST_PATH)).toBe(before[TEST_PATH])
})
