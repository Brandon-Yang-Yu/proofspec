// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { check, exitCodeOf, renderAnswer, touched } from '../../src/cli/index.ts'
import type { Outcome, TouchedReport } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, makeRepo, REQUIREMENT, sharedTestFile, specFile, testFile, TEST_PATH } from './support.ts'

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'

/** A repo under git whose one capability file records both scenarios its test proves. */
function inSync(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  }
}

/** The report, or a failure naming what came back instead — a wrong kind must not read as empty. */
function reportOf(outcome: Outcome): TouchedReport {
  if (outcome.kind !== 'touched') throw new Error(`expected a touched report, got ${outcome.kind}`)
  return outcome.report
}

/** The fixture's test file with one line inside the first proof's body rewritten. */
function bodyEdited(): string {
  return testFile([FIRST, SECOND]).replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)')
}

// Requirement: A command says which scenarios a change touched
// Scenario: A change inside a proof names the scenario and where its requirement is written
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN the touched command runs
// THEN the scenario that proof proves is named, with the requirement it proves and the line
//      of the capability file that requirement is written on, so the reader lands on the promise
it('names the scenario a changed proof proves and where its requirement is written', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios).toEqual([
    {
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: FIRST,
      // The site opens at its `// Requirement:` line, three lines above the test itself.
      file: TEST_PATH,
      from: 3,
      to: 8,
      changed: 'proof',
      claim: [{ keyword: 'THEN', text: 'the demonstrated claim holds', line: 5 }],
      proof: [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
      spec: { file: `specs/${CAPABILITY}.md`, line: 3 },
    },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A change committed since the branch left main is counted
// GIVEN a repo whose branch has committed a change to a proof since it left main
// WHEN the touched command runs
// THEN that scenario is still named, because the base is where the branch left main, not
//      HEAD — in a worktree the work is committed as it goes
it('counts a change committed on the branch since it left main', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit a proof'])

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios.map(one => one.scenario)).toEqual([FIRST])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A revision given on the command line replaces the branch point
// GIVEN a branch that has committed a change, and a run asked to compare against HEAD
// WHEN the touched command runs
// THEN the committed change is not named, because the comparison is against the revision
//      given rather than where the branch left main
it('compares against the revision given instead of the branch point', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit a proof'])

  const report = reportOf(await touched({ cwd: repo.root, since: 'HEAD' }))

  expect(report.scenarios).toEqual([])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A test file not yet added to git is counted
// GIVEN a new test file written but never added to git
// WHEN the touched command runs
// THEN every scenario it proves is named with both halves changed, because a file git has
//      never seen is new in whole, claim and proof alike
it('counts a test file that git has never seen', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write('tests/extra.test.ts', testFile(['A third behavior']))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios).toEqual([
    expect.objectContaining({ scenario: 'A third behavior', file: 'tests/extra.test.ts', changed: 'both' }),
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A proof the change removed is named from the base revision
// GIVEN a test file with one of its two proofs deleted
// WHEN the touched command runs
// THEN the deleted scenario is named as gone, read from the base revision, so a promise the
//      capability file still records but nothing proves any more is reported
it('names a proof the change removed', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST]))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.gone).toEqual([
    {
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      scenario: SECOND,
      file: TEST_PATH,
      spec: { file: `specs/${CAPABILITY}.md`, line: 3 },
    },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: Changed lines that prove nothing are reported as touching no scenario
// GIVEN a change to a line of a test file that no proof site covers
// WHEN the touched command runs
// THEN no scenario is named and the lines come back under the file they changed, so a
//      helper or an import is shown as a change with no promise behind it
it('reports changed lines that fall in no proof', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST, SECOND]).replace(`// Capability: ${CAPABILITY}`, `// Capability: ${CAPABILITY}\n// A note about this file`))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios).toEqual([])
  expect(report.unmatched).toEqual([{ file: TEST_PATH, from: 2, to: 2 }])
})

// Requirement: A command says which scenarios a change touched
// Scenario: Whatever it touched, the command exits zero
// GIVEN a change that touched a proof
// WHEN the touched command runs and its exit code is taken
// THEN it is zero, because naming what a change touched is a report, not a verdict — the
//      command that fails a build is the check
it('exits zero whatever it touched', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const outcome = await touched({ cwd: repo.root })

  expect(reportOf(outcome).scenarios).toHaveLength(1)
  expect(exitCodeOf(outcome)).toBe(0)
})

// Requirement: A command says which scenarios a change touched
// Scenario: A directory that is not a git repository cannot run
// GIVEN a repo laid out correctly but never put under git
// WHEN the touched command runs
// THEN it is cannot-run with a reason, told apart from a report of nothing touched, so CI
//      cannot read "no changes" out of "I could not look"
it('reports cannot-run where there is no git repository to read', async () => {
  const repo = await makeRepo(inSync())

  const outcome = await touched({ cwd: repo.root })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
})

// Requirement: A command says which scenarios a change touched
// Scenario: A touched scenario carries the source of the lines that prove it
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN the touched command runs
// THEN the scenario carries the proving lines as they are written, so an agent judging whether
//      the test still does what its claim says needs no second read of the file
it('carries the source of the lines that prove a touched scenario', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios.map(one => one.proof)).toEqual([
    [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: The touched command answers as JSON when no format is asked for
// GIVEN a touched report and no format named on the command line
// WHEN the answer is rendered
// THEN it comes back as JSON, because this report is read by an agent far more often than by
//      a person, and an agent should not have to remember a flag to be answered in its language
it('answers a touched report as JSON when no format is named', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }))

  expect(JSON.parse(answer)).toMatchObject({ scenarios: [{ scenario: FIRST, changed: 'proof' }] })
})

// Requirement: A command says which scenarios a change touched
// Scenario: A verdict still answers as text when no format is asked for
// GIVEN a checked outcome and no format named on the command line
// WHEN the answer is rendered
// THEN it comes back as text, because the default follows the kind of answer: a verdict is
//      what a person reads in the log of a build that just failed
it('answers a verdict as text when no format is named', async () => {
  const repo = await makeRepo(inSync())

  const answer = renderAnswer(await check({ cwd: repo.root }))

  expect(answer).toBe('pass')
})

// Requirement: A command says which scenarios a change touched
// Scenario: A scenario proven inside a shared test carries every run of lines that prove it
// GIVEN a repo whose test proves two scenarios under a shared GIVEN, with one line rewritten
//       inside the first scenario's own statement
// WHEN the touched command runs
// THEN that scenario carries both runs that prove it — the setup its test shares and its own
//      statement — because half the evidence is the wrong thing to judge a claim against
it('carries both runs of lines that prove a scenario inside a shared test', async () => {
  const shared = sharedTestFile([FIRST, SECOND])
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: shared,
  })
  await repo.write(TEST_PATH, shared.replace('expect(outcome.first).toBe(true)', 'expect(outcome.first).toBe(1)'))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.scenarios.map(one => one.proof)).toEqual([
    [
      { from: 5, to: 7, source: "it('one action, two promises', () => {\n  const outcome = act()\n" },
      { from: 11, to: 12, source: '  expect(outcome.first).toBe(1)\n' },
    ],
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A format named on the command line is the one used
// GIVEN a touched report, whose answer would otherwise be given as JSON
// WHEN the answer is rendered with text named as the format
// THEN it comes back as text, because a default is what happens when nobody chose, and
//      naming a format is choosing
it('gives the answer in the format named rather than the default', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }), 'text')

  expect(answer).toContain('[the proof changed]')
})
