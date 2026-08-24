// Capability: cli

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import type { TouchedRequirement } from '../../src/cli/index.ts'
import { requirementKey } from '../../src/review/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, REQUIREMENT, specFile, testFile, TEST_PATH } from './support.ts'

const execFileAsync = promisify(execFile)

afterEach(cleanupRepos)

/**
 * The one test that runs the command the way a user does: a real process, writing to a real
 * pipe. Everything else in `cli` calls the functions directly, which is where the decisions
 * live — but a process boundary has failure modes a function call cannot have, and an answer
 * cut in half by the pipe it was written to is one of them.
 */

/** The command's own entry point, run by node the way the `bin` entry does. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))

/** What a pipe holds before a writer has to wait for its reader: where a cut answer is cut. */
const PIPE_BUFFER = 65_536

/** Enough proofs that one requirement laid out for a person is larger than a pipe holds at once. */
const PROOFS = 120

/** The address that requirement is asked for by. */
const KEY = requirementKey({ capability: CAPABILITY, requirement: REQUIREMENT })

// Requirement: Any answer can be given in a form a program can read
// Scenario: An answer larger than a pipe holds reaches its reader whole
// GIVEN a repo where one requirement, asked for in full and laid out over indented lines, is
//       larger than a pipe's buffer
// WHEN the command is run as a program runs it, with its output read through a pipe
// THEN the whole answer arrives and parses, because a process that exits before its write has
//      drained cuts the answer at the buffer and hands its reader a syntax error instead
it('delivers an answer larger than a pipe holds whole', async () => {
  const scenarios = Array.from({ length: PROOFS }, (_, index) => `A behavior proven by the test written at position ${index}`)
  const proofs = testFile(scenarios)
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [] }),
    [TEST_PATH]: proofs,
  })
  await repo.write(TEST_PATH, proofs.replaceAll('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))

  const { stdout } = await execFileAsync(
    process.execPath,
    ['--experimental-transform-types', MAIN, 'touched', '--requirement', KEY, '--pretty'],
    { cwd: repo.root },
  )

  expect(stdout.length).toBeGreaterThan(PIPE_BUFFER)
  const report: TouchedRequirement = JSON.parse(stdout)
  expect(report.scenarios).toHaveLength(PROOFS)
})
