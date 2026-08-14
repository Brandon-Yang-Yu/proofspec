// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check, renderDiagnostics, renderQuickfix } from '../../src/cli/index.ts'
import { CAPABILITY, TEST_PATH, cleanupRepos, makeRepo, specFile, testFile } from './support.ts'

afterEach(cleanupRepos)

/** A repo proving a scenario its committed file does not record, so a check has findings. */
function drifting(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: ['A first behavior'] }),
    [TEST_PATH]: testFile(['A first behavior', 'A second behavior']),
  }
}

/**
 * The one finding a drifting repo produces: a scenario the tests prove but the committed file
 * does not record. Both renderer tests check against this same finding's file and line, so they
 * stay independent of each other and of any hard-coded line number.
 */
async function driftedFinding() {
  const repo = await makeRepo(drifting())
  const outcome = await check({ cwd: repo.root })
  if (outcome.kind !== 'checked') throw new Error('expected a checked outcome')
  const finding = outcome.report.findings[0]
  if (!finding) throw new Error('expected at least one finding')
  // drifting() proves a scenario the committed file does not record, so the one finding it
  // produces is a scenario-added — narrow to it so its `file` and `line` are in scope.
  if (finding.kind !== 'scenario-added') throw new Error(`expected scenario-added, got ${finding.kind}`)
  return { finding, outcome }
}

// Requirement: Any answer can be given in a form a program can read
// Scenario: The check's findings are returned in quickfix form for an editor to jump to
// GIVEN a repo that has drifted, so the check has a finding that carries a file and a line
// WHEN the check's answer is rendered as quickfix
// THEN each finding is a line `file:line:E: message` that an editor loads straight into its
//      jump list, naming the drifted scenario the way the text form does
it('returns findings as quickfix lines an editor can jump to', async () => {
  const { finding, outcome } = await driftedFinding()

  const lines = renderQuickfix(outcome).split('\n')
  expect(lines).toHaveLength(1)
  const line = lines[0]
  if (line === undefined) throw new Error('expected one quickfix line')
  const match = line.match(/^(.+):(\d+):([EW]): (.+)$/)
  expect(match, `quickfix line did not match file:line:severity: message — got: ${line}`).not.toBeNull()
  if (!match) return
  // The regex matched, so all four groups are present.
  const file = match[1]!
  const lineNo = match[2]!
  const severity = match[3]!
  const message = match[4]!

  expect(file).toBe(finding.file)
  expect(Number(lineNo)).toBe(finding.line) // the finding's line, 1-based
  expect(severity).toBe('E') // scenario-added fails the build
  expect(message).toContain('A second behavior')
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The check's findings are returned as LSP diagnostics a modern editor shows inline
// GIVEN a repo that has drifted, so the check has a finding that carries a file and a line
// WHEN the check's answer is rendered as diagnostics
// THEN the JSON carries one diagnostic per finding with a severity, a zero-based line range,
//      the finding's message, and the finding's kind as its code, so an LSP client shows the
//      same content inline that a person reads in the terminal
it('returns findings as LSP diagnostics an editor shows inline', async () => {
  const { finding, outcome } = await driftedFinding()

  const parsed: unknown = JSON.parse(renderDiagnostics(outcome))
  expect(parsed).toEqual({
    diagnostics: [
      {
        severity: 1, // LSP Error — scenario-added fails the build
        range: {
          // zero-based, one less than the quickfix line, matching the finding's location
          start: { line: finding.line - 1, character: 0 },
          end: { line: finding.line - 1, character: 0 },
        },
        message: expect.stringContaining('A second behavior'),
        source: 'proofspec',
        code: finding.kind,
      },
    ],
  })
})
