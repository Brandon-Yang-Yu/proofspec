// Capability: cli

import { rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { check, exitCodeOf, renderAnswer, touched } from '../../src/cli/index.ts'
import type { Outcome, TouchedReport, TouchedScenarioReport } from '../../src/cli/index.ts'
import { compareStrings } from '../../src/order.ts'
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

/**
 * Every touched scenario the report holds, in file order, whatever requirement it sits under.
 * The report groups by requirement; most scenarios below are about one requirement's worth of
 * proofs, and read better against the flat list a person sees in the terminal.
 */
function scenariosOf(report: TouchedReport): readonly TouchedScenarioReport[] {
  return report.requirements
    .flatMap(under => under.scenarios)
    .sort((a, b) => compareStrings(a.file, b.file) || a.from - b.from)
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

  expect(report.requirements).toEqual([
    {
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      spec: expect.objectContaining({ file: `specs/${CAPABILITY}.md`, line: 3 }),
      scenarios: [
        {
          scenario: FIRST,
          // The site opens at its `// Requirement:` line, three lines above the test itself.
          file: TEST_PATH,
          from: 3,
          to: 8,
          changed: 'proof',
          claim: [{ keyword: 'THEN', text: 'the demonstrated claim holds', line: 5 }],
          proof: [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
        },
      ],
      gone: [],
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

  expect(scenariosOf(report).map(one => one.scenario)).toEqual([FIRST])
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

  expect(report.requirements).toEqual([])
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

  expect(scenariosOf(report)).toEqual([
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

  expect(report.requirements).toEqual([
    expect.objectContaining({
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      spec: expect.objectContaining({ file: `specs/${CAPABILITY}.md`, line: 3 }),
      gone: [{ scenario: SECOND, file: TEST_PATH }],
    }),
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

  expect(scenariosOf(report)).toEqual([])
  expect(report.unmatched).toEqual([
    { file: TEST_PATH, from: 2, to: 2, source: '// A note about this file' },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: Changed lines that fall in no proof carry the source of those lines
// GIVEN a change to a line of a helper beside the tests, which no proof covers and the scan,
//       reading only test files, never read
// WHEN the touched command runs
// THEN the line comes back as it is now written, read back from the file, because an edit to a
//      helper is usually a line or two and sending a reader to open the file costs more than it
it('carries the source of changed lines that fall in no proof', async () => {
  const helper = ['export function act() {', '  return { first: true }', '}', ''].join('\n')
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': helper })
  await repo.write('tests/support.ts', helper.replace('{ first: true }', '{ first: false }'))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.unmatched).toEqual([
    { file: 'tests/support.ts', from: 2, to: 2, source: '  return { first: false }' },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A changed run that is nothing but blank lines is not reported
// GIVEN a change that adds a blank line to a test file, outside every proof
// WHEN the touched command runs
// THEN nothing is reported at all: a blank line belongs to no promise and says nothing to the
//      reader, and there are more of them in a diff than there are edits worth reading
it('reports nothing for a changed run that is only blank lines', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST, SECOND]).replace(`// Capability: ${CAPABILITY}`, `// Capability: ${CAPABILITY}\n`))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.unmatched).toEqual([])
  expect(scenariosOf(report)).toEqual([])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A changed file that cannot be read back cannot run
// GIVEN a helper git reports as changed which is not there to be read: replaced by a link to
//       nothing, so git sees new content and the filesystem hands back none
// WHEN the touched command runs
// THEN it reports it cannot run, because carrying that file's changed lines as blank would be a
//      claim about those lines, and a wrong one
it('reports cannot-run when a changed file cannot be read back', async () => {
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': 'export const act = () => true\n' })
  const path = join(repo.root, 'tests/support.ts')
  await rm(path)
  await symlink('nowhere', path)

  const outcome = await touched({ cwd: repo.root })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
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

  expect(scenariosOf(reportOf(outcome))).toHaveLength(1)
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

  expect(scenariosOf(report).map(one => one.proof)).toEqual([
    [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: The requirement a touched scenario proves carries the prose written under it
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN the touched command runs
// THEN the requirement that scenario proves comes back with the prose its capability file
//      writes under it, so the claim can be judged against the standard it serves without
//      opening the file the report points at
it('carries the prose written under the requirement a touched scenario proves', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.requirements.map(one => one.spec)).toEqual([
    {
      file: `specs/${CAPABILITY}.md`,
      line: 3,
      description: 'The tool SHALL demonstrate the pipeline end to end.',
    },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: One requirement holds every scenario of it the change touched
// GIVEN a change that rewrites a line inside both proofs of one requirement
// WHEN the touched command runs
// THEN both scenarios come back under a single requirement, so its prose is written once
//      however many of its promises the change reached
it('holds every touched scenario of a requirement under one entry', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST, SECOND]).replaceAll('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.requirements.map(one => one.requirement)).toEqual([REQUIREMENT])
  expect(report.requirements[0]?.scenarios.map(one => one.scenario)).toEqual([FIRST, SECOND])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A requirement no capability file declares carries no prose
// GIVEN a change inside a proof whose requirement no capability file declares
// WHEN the touched command runs
// THEN the scenario is still named under that requirement, with nothing where the position and
//      the prose would be: none is written, and the check is what reports the gap
it('carries no prose for a requirement no capability file declares', async () => {
  const undeclared = testFile([FIRST], { requirement: 'A promise nobody wrote down' })
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [] }),
    [TEST_PATH]: undeclared,
  })
  await repo.write(TEST_PATH, undeclared.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(report.requirements).toEqual([
    expect.objectContaining({ requirement: 'A promise nobody wrote down', spec: undefined }),
  ])
  expect(scenariosOf(report).map(one => one.scenario)).toEqual([FIRST])
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

  expect(JSON.parse(answer)).toMatchObject({
    requirements: [{ requirement: REQUIREMENT, scenarios: [{ scenario: FIRST, changed: 'proof' }] }],
  })
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

  expect(scenariosOf(report).map(one => one.proof)).toEqual([
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

  const answer = renderAnswer(await touched({ cwd: repo.root }), { format: 'text' })

  expect(answer).toContain('[the proof changed]')
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The JSON answer is laid out over indented lines when a person asks for it
// GIVEN a touched report, whose answer is given as JSON
// WHEN the answer is rendered asking for the indented layout
// THEN it comes back over several indented lines carrying the same report, so the person
//      reviewing what a change touched reads the answer as printed rather than piping it
//      through another tool
it('lays the JSON answer out over indented lines when asked', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())
  const outcome = await touched({ cwd: repo.root })

  const answer = renderAnswer(outcome, { layout: 'indented' })

  expect(answer).toContain('\n  "requirements"')
  expect(JSON.parse(answer)).toEqual(JSON.parse(renderAnswer(outcome)))
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The JSON answer stays on one line when no layout is asked for
// GIVEN a touched report, whose answer is given as JSON
// WHEN the answer is rendered with no layout asked for
// THEN it comes back on a single line, because laying it out is a choice the caller makes:
//      the answer a script already reads must not change under a flag it never passed
it('keeps the JSON answer on one line when no layout is asked for', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }))

  expect(answer).not.toContain('\n')
})

// Requirement: A command says which scenarios a change touched
// Scenario: Touched scenarios come back in file order
// GIVEN a change that edits a tracked test file and adds an untracked one sorting before it
// WHEN the touched command runs
// THEN the scenarios come back in file order, because git lists what it already tracks ahead
//      of what it has never seen, and a report an agent re-reads across runs has to be stable
it('names touched scenarios in file order', async () => {
  const tracked = testFile([SECOND])
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    'tests/zulu.test.ts': tracked,
  })
  await repo.write('tests/zulu.test.ts', tracked.replace('  expect(true).toBe(true)', '  expect(2).toBe(2)'))
  await repo.write('tests/alpha.test.ts', testFile([FIRST]))

  const report = reportOf(await touched({ cwd: repo.root }))

  expect(scenariosOf(report).map(one => one.file)).toEqual(['tests/alpha.test.ts', 'tests/zulu.test.ts'])
})
