// Capability: cli

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { exitCodeOf, review, touched } from '../../src/cli/index.ts'
import type { Outcome, ProposedInput, TouchedRequirement } from '../../src/cli/index.ts'
import { LEDGER_PATH } from '../../src/cli/reviews.ts'
import { readLedger, requirementKey, REVIEW_PROTOCOL, VERDICTS } from '../../src/review/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, REQUIREMENT, specFile, testFile, TEST_PATH } from './support.ts'

const execFileAsync = promisify(execFile)

/** The command's own entry point, run by node the way the `bin` entry does. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'
const KEY = requirementKey({ capability: CAPABILITY, requirement: REQUIREMENT })

/** A repo whose first proof has been rewritten, so exactly one promise waits to be judged. */
async function repoWithOneTouched(): ReturnType<typeof makeGitRepo> {
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  })
  await repo.write(TEST_PATH, testFile([FIRST, SECOND]).replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))
  return repo
}

/** That one promise, as the requirement it sits under hands it over. */
async function firstPending(cwd: string): Promise<TouchedRequirement['scenarios'][number]> {
  const outcome = await touched({ cwd, ask: { kind: 'requirement', key: KEY } })
  if (outcome.kind !== 'touched' || outcome.report.kind !== 'requirement') {
    throw new Error(`expected the requirement answer, got ${outcome.kind}`)
  }
  const [scenario] = outcome.report.scenarios
  if (scenario === undefined) throw new Error('expected a touched scenario to judge')
  return scenario
}

/** A review as the command line gives it, defaulting to a pass over the proof's middle line. */
function proposal(fields: Partial<ProposedInput> & { readonly key: string }): ProposedInput {
  return {
    key: fields.key,
    verdict: fields.verdict ?? 'ok',
    proves: 'proves' in fields ? fields.proves : 7,
    note: fields.note,
    by: 'by' in fields ? fields.by : 'a reviewer',
  }
}

// Requirement: A command records a review of one touched scenario
// Scenario: A recorded review is appended to the LEDGER
// GIVEN a change that touched one PROOF, and a reviewer passing it while citing a line of it
// WHEN the review command runs
// THEN the LEDGER holds that judgement, carrying the cited line as written and who made it,
//      because the record is committed and read in a pull request by a person
it('appends a recorded review to the ledger', async () => {
  const repo = await repoWithOneTouched()
  const scenario = await firstPending(repo.root)

  const outcome = await review({ cwd: repo.root, review: proposal({ key: scenario.key }) })

  expect(outcome.kind).toBe('reviewed')
  expect(exitCodeOf(outcome)).toBe(0)
  expect(readLedger(await repo.read(LEDGER_PATH))).toEqual({
    ok: true,
    entries: [
      expect.objectContaining({
        key: scenario.key,
        capability: CAPABILITY,
        requirement: REQUIREMENT,
        scenario: FIRST,
        verdict: 'ok',
        cites: { line: 7, source: '  expect(1 + 1).toBe(2)' },
        by: 'a reviewer',
      }),
    ],
  })
})

// Requirement: A command records a review of one touched scenario
// Scenario: A review of a PROMISE the change did not reach cannot run
// GIVEN a KEY that names no PROMISE this change reached
// WHEN the review command runs
// THEN it is cannot-run, because a KEY that no longer matches anything is what a stale review
//      looks like, and accepting it would file a judgement nothing will ever read
it('reports cannot-run for a key no promise this change carries', async () => {
  const repo = await repoWithOneTouched()

  const outcome = await review({ cwd: repo.root, review: proposal({ key: 'ffffffffffff' }) })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
})

// Requirement: A command records a review of one touched scenario
// Scenario: A pass citing a line outside the PROOF cannot run
// GIVEN a pass citing a line the scenario's PROOF does not own
// WHEN the review command runs
// THEN it is cannot-run and nothing is written, because a citation nobody checked is a
//      signature rather than a review, and the LEDGER must not carry one
it('refuses a pass citing a line the proof does not own, and writes nothing', async () => {
  const repo = await repoWithOneTouched()
  const scenario = await firstPending(repo.root)

  const outcome = await review({ cwd: repo.root, review: proposal({ key: scenario.key, proves: 99 }) })

  expect(outcome.kind).toBe('cannot-run')
  await expect(repo.read(LEDGER_PATH)).rejects.toThrow()
})

// Requirement: A command records a review of one touched scenario
// Scenario: A reviewed scenario is no longer pending in the work list
// GIVEN a change whose one touched scenario has been judged as drifting
// WHEN the work list is asked for again
// THEN nothing of it is pending, and the scenario carries the judgement standing against it
//      when it is fetched — a reported problem is judged, because a reviewer who cannot report
//      one without blocking their own branch has a reason to write a pass instead
it('leaves a judged scenario out of what is pending, whatever the judgement said', async () => {
  const repo = await repoWithOneTouched()
  const scenario = await firstPending(repo.root)
  await review({
    cwd: repo.root,
    review: proposal({ key: scenario.key, verdict: 'drift', proves: undefined, note: 'the THEN says less than the test does' }),
  })

  const outcome = await touched({ cwd: repo.root })

  expect(summaryPending(outcome)).toEqual([0])
  expect((await firstPending(repo.root)).reviewed).toEqual({
    verdict: 'drift',
    by: 'a reviewer',
    at: expect.any(String),
  })
})

// Requirement: A command records a review of one touched scenario
// Scenario: A verdict the tool does not know cannot run
// GIVEN a review offering a word that names no verdict
// WHEN the review command runs
// THEN it is cannot-run naming what a verdict may be, and nothing is written, because that is
//      a decision about a value rather than about what the options can hold, so it belongs
//      where a test can reach it rather than in the argument parser
it('reports cannot-run for a verdict it does not know', async () => {
  const repo = await repoWithOneTouched()
  const scenario = await firstPending(repo.root)

  const outcome = await review({
    cwd: repo.root,
    review: { ...proposal({ key: scenario.key }), verdict: 'looks-fine' },
  })

  expect(outcome).toEqual({
    kind: 'cannot-run',
    // The whole message rather than a fragment of it, so dropping the list of verdicts fails
    // here. Both halves of the claim are in it: that the word was refused, and what the words
    // are — and a reviewer who typed the wrong one is exactly who needs the second half.
    reason: `cannot review: looks-fine is not a verdict. Use ${VERDICTS.join(', ')}.`,
  })
  expect(exitCodeOf(outcome)).toBe(2)
  await expect(repo.read(LEDGER_PATH)).rejects.toThrow()
})

// Requirement: A command records a review of one touched scenario
// Scenario: A LEDGER that cannot be read cannot run
// GIVEN a LEDGER holding a line that is not a review — the shape a half-resolved merge leaves
// WHEN the work list is asked for
// THEN it is cannot-run rather than an answer built on the reviews it could still parse: a
//      PROMISE counted as judged because the line saying otherwise was skipped is the one
//      failure the record exists to prevent
it('reports cannot-run when the ledger holds a line it cannot read', async () => {
  const repo = await repoWithOneTouched()
  await repo.write(LEDGER_PATH, '<<<<<<< HEAD\n')

  const outcome = await touched({ cwd: repo.root })

  expect(outcome).toEqual({ kind: 'cannot-run', reason: expect.stringContaining('not a review') })
  expect(exitCodeOf(outcome)).toBe(2)
})

// Requirement: The requirement asked for carries how its scenarios are to be judged
// Scenario: The pass the protocol hands over is one the command line accepts
// GIVEN the pass the protocol tells a reviewer to run, with its placeholders filled in
// WHEN it is run through the real entry point the way a reviewer runs it
// THEN the judgement is recorded, because instructions the tool hands over and never checks
//      against itself are a help string that goes stale the first time a flag is renamed
it('hands over a pass the command line actually accepts', async () => {
  const repo = await repoWithOneTouched()
  const scenario = await firstPending(repo.root)
  const filled = REVIEW_PROTOCOL.pass
    .replace('<key>', scenario.key)
    .replace('<line>', '7')
    .replace('<who>', 'a-reviewer')

  await runAsTyped(repo.root, filled)

  expect(readLedger(await repo.read(LEDGER_PATH))).toEqual({
    ok: true,
    entries: [expect.objectContaining({ key: scenario.key, verdict: 'ok', by: 'a-reviewer' })],
  })
})

/**
 * One of the protocol's lines as a real process runs it. The words after `proofspec` are its
 * arguments, so putting them through the actual entry point is what holds the instruction to
 * account — a function call would take whatever shape the test invented instead.
 */
async function runAsTyped(cwd: string, line: string): Promise<void> {
  const [named, ...args] = line.split(' ')
  expect(named).toBe('proofspec')
  await execFileAsync(process.execPath, ['--experimental-transform-types', MAIN, ...args], { cwd })
}

/** How much of each requirement the work list still counts as unjudged. */
function summaryPending(outcome: Outcome): readonly number[] {
  if (outcome.kind !== 'touched' || outcome.report.kind !== 'summary') {
    throw new Error(`expected the work list, got ${outcome.kind}`)
  }
  return outcome.report.requirements.map(one => one.pending)
}
