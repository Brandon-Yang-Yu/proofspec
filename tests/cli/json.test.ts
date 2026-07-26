// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check, renderJson, renderText, write } from '../../src/cli/index.ts'
import { CAPABILITY, TEST_PATH, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

/** A repo proving a scenario its committed file does not record, so a check has findings. */
function drifting(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: ['A first behavior'] }),
    [TEST_PATH]: testFile(['A first behavior', 'A second behavior']),
  }
}

// Requirement: Any answer can be given in a form a program can read
// Scenario: The check's verdict is returned as JSON carrying the same findings
// GIVEN a repo that has drifted, so the check has findings to report
// WHEN the check is asked for its answer as JSON
// THEN the JSON parses to the report, and the form written for a person carries those same
//      findings, so another tool reads the same answer rather than parsing the terminal form
it('returns the same verdict as JSON that it reports to a person', async () => {
  const repo = await makeRepo(drifting())

  const outcome = await check({ cwd: repo.root })
  expect(outcome.kind).toBe('checked')
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')

  const asJson: unknown = JSON.parse(renderJson(outcome))
  const asText = renderText(outcome)

  expect(outcome.report.status).toBe('fail')
  expect(asJson).toEqual(outcome.report)
  // The human form is not empty and names the very scenario the JSON reports as drifted, so
  // a text renderer that dropped or blanked findings could not pass with the JSON intact.
  expect(asText).toContain('A second behavior')
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The write's answer is returned as JSON naming the changed files
// GIVEN a repo whose committed file is missing a scenario the tests prove
// WHEN the write runs and is asked for its answer as JSON
// THEN the JSON names the files it changed, so the write command too can be read by a
//      program and not only by a person
it('returns the files a write changed as JSON', async () => {
  const repo = await makeRepo(drifting())

  const outcome = await write({ cwd: repo.root })
  expect(outcome.kind).toBe('wrote')
  if (outcome.kind !== 'wrote') throw new Error('expected a wrote outcome')

  const asJson: unknown = JSON.parse(renderJson(outcome))

  expect(asJson).toEqual({ changed: [`specs/${CAPABILITY}.md`] })
})
