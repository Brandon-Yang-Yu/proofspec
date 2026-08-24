// Capability: cli

import { rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { check, exitCodeOf, renderAnswer, review, touched } from '../../src/cli/index.ts'
import type {
  Outcome,
  TouchedReport,
  TouchedRequirement,
  TouchedScenarioReport,
  TouchedSummary,
  TouchedUnmatched,
} from '../../src/cli/index.ts'
import { REVIEW_PROTOCOL, requirementKey } from '../../src/review/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, makeRepo, REQUIREMENT, sharedTestFile, specFile, testFile, TEST_PATH } from './support.ts'

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'

/** The address the fixture's one requirement is asked for by. */
const KEY = requirementKey({ capability: CAPABILITY, requirement: REQUIREMENT })

/** A repo under git whose one capability file records both scenarios its test proves. */
function inSync(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  }
}

/**
 * The report an outcome carries. Naming what came back instead rather than returning nothing:
 * an answer of the wrong shape must not read as an answer of this one with nothing in it.
 */
function reportOf(outcome: Outcome): TouchedReport {
  if (outcome.kind !== 'touched') throw new Error(`expected a touched report, got ${outcome.kind}`)
  return outcome.report
}

function summaryOf(outcome: Outcome): TouchedSummary {
  const report = reportOf(outcome)
  if (report.kind !== 'summary') throw new Error(`expected the work list, got ${report.kind}`)
  return report
}

function requirementOf(outcome: Outcome): TouchedRequirement {
  const report = reportOf(outcome)
  if (report.kind !== 'requirement') throw new Error(`expected one requirement, got ${report.kind}`)
  return report
}

function unmatchedOf(outcome: Outcome): TouchedUnmatched {
  const report = reportOf(outcome)
  if (report.kind !== 'unmatched') throw new Error(`expected the unmatched lines, got ${report.kind}`)
  return report
}

/** The fixture's one requirement, asked for in full. */
async function requirementIn(cwd: string): Promise<TouchedRequirement> {
  return requirementOf(await touched({ cwd, ask: { kind: 'requirement', key: KEY } }))
}

/** Every scenario that requirement holds, in the file order the report keeps them in. */
function scenariosOf(report: TouchedRequirement): readonly TouchedScenarioReport[] {
  return report.scenarios
}

/** The fixture's test file with one line inside the first proof's body rewritten. */
function bodyEdited(): string {
  return testFile([FIRST, SECOND]).replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)')
}

/** A pass over the first pending promise of the fixture's requirement, citing a line of its proof. */
async function passFirst(cwd: string, proves: number): Promise<Outcome> {
  const [scenario] = scenariosOf(await requirementIn(cwd))
  return review({
    cwd,
    review: { key: scenario?.key ?? '', verdict: 'ok', proves, note: undefined, by: 'a reviewer' },
  })
}

// Requirement: A command says which scenarios a change touched
// Scenario: The touched command answers with one entry for each requirement it reached
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN the touched command runs with nothing in particular asked for
// THEN it answers with the requirement counted rather than written out, because this is the
//      answer read on every run and one that carried the claims would be the whole branch again
it('answers with a count for each requirement the change reached', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements).toEqual([
    { key: KEY, capability: CAPABILITY, requirement: REQUIREMENT, scenarios: 1, gone: 0, pending: 1 },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A change inside a proof names the scenario and where its requirement is written
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN that requirement is asked for in full
// THEN the scenario that proof proves is named, with the requirement it proves and the line
//      of the capability file that requirement is written on, so the reader lands on the promise
it('names the scenario a changed proof proves and where its requirement is written', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = await requirementIn(repo.root)

  expect(report).toEqual(
    expect.objectContaining({
      key: KEY,
      capability: CAPABILITY,
      requirement: REQUIREMENT,
      spec: expect.objectContaining({ file: `specs/${CAPABILITY}.md`, line: 3 }),
      scenarios: [
        {
          key: expect.any(String),
          scenario: FIRST,
          // The site opens at its `// Requirement:` line, three lines above the test itself.
          file: TEST_PATH,
          from: 3,
          to: 8,
          changed: 'proof',
          claim: [{ keyword: 'THEN', text: 'the demonstrated claim holds', line: 5 }],
          proof: [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
          reviewed: undefined,
        },
      ],
      gone: [],
    }),
  )
})

// Requirement: A command says which scenarios a change touched
// Scenario: A key no touched requirement carries cannot run
// GIVEN a change that reached one requirement, and an address that names none of them
// WHEN that address is asked for
// THEN it is cannot-run rather than an empty requirement, because a stale key handed back as
//      "nothing to judge here" is how a reviewer works through a list and reviews nothing
it('reports cannot-run for an address no touched requirement carries', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const outcome = await touched({ cwd: repo.root, ask: { kind: 'requirement', key: 'ffffffffffff' } })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
})

// Requirement: A command says which scenarios a change touched
// Scenario: A change committed since the branch left main is counted
// GIVEN a branch that has committed a change to a proof since it left main
// WHEN the touched command runs
// THEN its requirement counts the scenario among those reached, because the question is what
//      this branch touched rather than what is uncommitted
it('counts a change committed on the branch since it left main', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit a proof'])

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])
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

  const summary = summaryOf(await touched({ cwd: repo.root, since: 'HEAD' }))

  expect(summary.requirements).toEqual([])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A test file not yet added to git is counted
// GIVEN a new test file written but never added to git
// WHEN the touched command runs
// THEN every scenario it proves is counted, because a file git has never seen is new in whole,
//      claim and proof alike
it('counts a test file that git has never seen', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write('tests/extra.test.ts', testFile(['A third behavior']))

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A proof the change removed is named from the base revision
// GIVEN a change that deleted one of the two proofs in a test file
// WHEN that requirement is asked for in full
// THEN the scenario it used to prove is named as gone, read out of the base revision, so a
//      promise left with nothing behind it surfaces at review time
it('names a proof the change removed', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST]))
  await repo.write(`specs/${CAPABILITY}.md`, specFile({ recorded: [FIRST] }))

  const report = await requirementIn(repo.root)

  expect(report.gone).toEqual([
    { key: expect.any(String), scenario: SECOND, file: TEST_PATH, reviewed: undefined },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: The lines that prove nothing are counted in the work list and asked for on their own
// GIVEN a change to a helper file beside the tests, which no proof owns
// WHEN the touched command runs, and then those lines are asked for
// THEN the work list carries their number and nothing else, and asking for them gives the runs
//      themselves — they are not work anyone judges, and on a real branch there are more of
//      them than there are promises to read
it('counts the lines that prove nothing, and gives them when they are asked for', async () => {
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': 'export const helper = 1\n' })
  await repo.write('tests/support.ts', 'export const helper = 2\n')

  const summary = summaryOf(await touched({ cwd: repo.root }))
  const lines = unmatchedOf(await touched({ cwd: repo.root, ask: { kind: 'unmatched' } }))

  expect(summary).toEqual(expect.objectContaining({ requirements: [], unmatched: 1 }))
  expect(lines.lines).toEqual([
    { file: 'tests/support.ts', from: 1, to: 1, source: 'export const helper = 2' },
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A changed run that is nothing but blank lines is not reported
// GIVEN a change that only adds a blank line to a helper beside the tests
// WHEN the lines that prove nothing are asked for
// THEN none are given, because git hands a blank line back with every block inserted beside it
//      and they would outnumber the edits worth reading
it('reports nothing for a changed run that is only blank lines', async () => {
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': 'export const helper = 1\n' })
  await repo.write('tests/support.ts', 'export const helper = 1\n\n')

  const lines = unmatchedOf(await touched({ cwd: repo.root, ask: { kind: 'unmatched' } }))

  expect(lines.lines).toEqual([])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A changed file that cannot be read back cannot run
// GIVEN a changed file git names but that cannot be read back from the working tree
// WHEN the touched command runs
// THEN it is cannot-run, because carrying its lines as blank would be a claim about them and
//      a wrong one
it('reports cannot-run when a changed file cannot be read back', async () => {
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': 'export const helper = 1\n' })
  await rm(join(repo.root, 'tests/support.ts'))
  await symlink('nowhere.ts', join(repo.root, 'tests/support.ts'))

  const outcome = await touched({ cwd: repo.root })

  expect(outcome.kind).toBe('cannot-run')
  expect(exitCodeOf(outcome)).toBe(2)
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
// WHEN that requirement is asked for in full
// THEN the scenario carries the proving lines as they are written, so an agent judging whether
//      the test still does what its claim says needs no second read of the file
it('carries the source of the lines that prove a touched scenario', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = await requirementIn(repo.root)

  expect(scenariosOf(report).map(one => one.proof)).toEqual([
    [{ from: 6, to: 8, source: 'it("A first behavior", () => {\n  expect(1 + 1).toBe(2)\n})' }],
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: The requirement a touched scenario proves carries the prose written under it
// GIVEN a repo under git whose test and capability file agree, with one line rewritten inside a proof
// WHEN that requirement is asked for in full
// THEN it comes back with the prose its capability file writes under it, so the claim can be
//      judged against the standard it serves without opening the file the report points at
it('carries the prose written under the requirement a touched scenario proves', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = await requirementIn(repo.root)

  expect(report.spec).toEqual({
    file: `specs/${CAPABILITY}.md`,
    line: 3,
    description: 'The tool SHALL demonstrate the pipeline end to end.',
  })
})

// Requirement: A command says which scenarios a change touched
// Scenario: One requirement holds every scenario of it the change touched
// GIVEN a change that rewrites a line inside both proofs of one requirement
// WHEN that requirement is asked for in full
// THEN both scenarios come back under it, so its prose is written once however many of its
//      promises the change reached
it('holds every touched scenario of a requirement under one entry', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, testFile([FIRST, SECOND]).replaceAll('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))

  const report = await requirementIn(repo.root)

  expect(report.requirement).toBe(REQUIREMENT)
  expect(scenariosOf(report).map(one => one.scenario)).toEqual([FIRST, SECOND])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A requirement no capability file declares carries no prose
// GIVEN a change inside a proof whose requirement no capability file declares
// WHEN that requirement is asked for in full
// THEN the scenario is still named under it, with nothing where the position and the prose
//      would be: none is written, and the check is what reports the gap
it('carries no prose for a requirement no capability file declares', async () => {
  const undeclared = testFile([FIRST], { requirement: 'A promise nobody wrote down' })
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [] }),
    [TEST_PATH]: undeclared,
  })
  await repo.write(TEST_PATH, undeclared.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))
  const key = requirementKey({ capability: CAPABILITY, requirement: 'A promise nobody wrote down' })

  const report = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key } }))

  expect(report.spec).toBeUndefined()
  expect(scenariosOf(report).map(one => one.scenario)).toEqual([FIRST])
})

// Requirement: A command says which scenarios a change touched
// Scenario: A scenario proven inside a shared test carries every run of lines that prove it
// GIVEN a change inside one block of a test proving two scenarios
// WHEN that requirement is asked for in full
// THEN the block carries the setup its test shares as well as its own statements, and none of
//      its sibling's, because judging a claim against another's evidence is the error to avoid
it('carries both runs of lines that prove a scenario inside a shared test', async () => {
  const shared = sharedTestFile([FIRST, SECOND])
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: shared,
  })
  await repo.write(TEST_PATH, shared.replace('  expect(outcome.first).toBe(true)', '  expect(outcome.first).toBe(1)'))

  const report = await requirementIn(repo.root)

  expect(scenariosOf(report).map(one => one.proof)).toEqual([
    [
      { from: 5, to: 7, source: "it('one action, two promises', () => {\n  const outcome = act()\n" },
      { from: 11, to: 12, source: '  expect(outcome.first).toBe(1)\n' },
    ],
  ])
})

// Requirement: A command says which scenarios a change touched
// Scenario: Touched scenarios come back in file order
// GIVEN a change reaching proofs in two test files, the later-named file listed first by git
// WHEN that requirement is asked for in full
// THEN the scenarios come back in file order rather than the order the diff arrived in, so two
//      runs of the same branch are comparable
it('names touched scenarios in file order', async () => {
  const second = testFile([SECOND])
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    'tests/b.test.ts': second,
  })
  await repo.write('tests/b.test.ts', second.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))
  await repo.write('tests/a.test.ts', testFile([FIRST]))

  const report = await requirementIn(repo.root)

  expect(scenariosOf(report).map(one => one.file)).toEqual(['tests/a.test.ts', 'tests/b.test.ts'])
})

// Requirement: The touched command holds the gate until every promise it reached has been judged
// Scenario: A work list with a promise left unjudged exits non-zero
// GIVEN a change that touched a proof nobody has judged
// WHEN the work list is asked for and its exit code is taken
// THEN it is non-zero, which is what lets a hook hold the gate. It is not the tool judging the
//      change: it is the tool saying nobody has, and the two commands that exit non-zero send
//      a reader to different places — the check to the spec, this to the review
it('exits non-zero while a promise it reached is unjudged', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const outcome = await touched({ cwd: repo.root })

  expect(summaryOf(outcome).requirements.map(one => one.pending)).toEqual([1])
  expect(exitCodeOf(outcome)).toBe(1)
})

// Requirement: The touched command holds the gate until every promise it reached has been judged
// Scenario: A work list with every promise judged exits zero
// GIVEN a change whose one touched scenario has been passed by a reviewer
// WHEN the work list is asked for and its exit code is taken
// THEN it is zero, and the requirement still appears with nothing pending, because the list is
//      also the record of what this branch reached
it('exits zero once every promise it reached has been judged', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())
  await passFirst(repo.root, 7)

  const outcome = await touched({ cwd: repo.root })

  expect(summaryOf(outcome).requirements.map(one => one.pending)).toEqual([0])
  expect(exitCodeOf(outcome)).toBe(0)
})

// Requirement: The touched command holds the gate until every promise it reached has been judged
// Scenario: Asking for one requirement exits zero however much is unjudged
// GIVEN a change that touched a proof nobody has judged
// WHEN that requirement is asked for in full and its exit code is taken
// THEN it is zero, because fetching the work is not the gate — an agent partway through the
//      reviewing would read every fetch as a broken tool, and stop
it('exits zero when a requirement is fetched, however much of it is unjudged', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const outcome = await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } })

  expect(requirementOf(outcome).scenarios.map(one => one.reviewed)).toEqual([undefined])
  expect(exitCodeOf(outcome)).toBe(0)
})

// Requirement: The requirement asked for carries how its scenarios are to be judged
// Scenario: The requirement asked for carries how its scenarios are to be judged
// GIVEN a change that touched a proof
// WHEN that requirement is asked for in full
// THEN it carries how to judge what is under it, because a reviewer asked "is this claim
//      honest?" answers yes and one asked to find the overstatement goes looking, and which of
//      the two gets asked cannot be left to whoever remembers to ask
it('carries how its scenarios are to be judged', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const report = await requirementIn(repo.root)

  expect(report.review).toEqual(REVIEW_PROTOCOL)
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The touched command answers as JSON when no format is asked for
// GIVEN a touched report and no format named on the command line
// WHEN the answer is rendered
// THEN it comes back as JSON, because this report is read by an agent far more often than by
//      a person, and an agent should not have to remember a flag to be answered in its language
it('answers a touched report as JSON when no format is named', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }), {})

  expect(JSON.parse(answer)).toEqual(expect.objectContaining({ kind: 'summary' }))
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: A verdict still answers as text when no format is asked for
// GIVEN a check's verdict and no format named on the command line
// WHEN the answer is rendered
// THEN it comes back as text, because what a person reads in the log of a build that just
//      failed is a verdict, and the default follows the kind of answer rather than the tool
it('answers a verdict as text when no format is named', async () => {
  const repo = await makeRepo(inSync())

  const answer = renderAnswer(await check({ cwd: repo.root }), {})

  expect(answer).toBe('pass')
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: A format named on the command line is the one used
// GIVEN a touched report and text named as the format
// WHEN the answer is rendered
// THEN it comes back as text rather than the JSON the report defaults to, so naming a format
//      is always the one that decides
it('gives the answer in the format named rather than the default', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }), { format: 'text' })

  // The requirement's name alone would not tell the two apart: it is a field value in the
  // JSON as well, so an ignored format would pass that check. Only the text form opens on a
  // sentence, and only the JSON form parses.
  expect(answer).toMatch(/^touched since \w+ — 1 promise\(s\) still unjudged/)
  expect(() => JSON.parse(answer)).toThrow()
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The JSON answer is laid out over indented lines when a person asks for it
// GIVEN a touched report and a caller asking for the answer laid out
// WHEN the answer is rendered
// THEN it comes back over indented lines carrying the same report, because a person reading it
//      in a terminal would otherwise reach for another tool to reformat it
it('lays the JSON answer out over indented lines when asked', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())
  const outcome = await touched({ cwd: repo.root })

  const answer = renderAnswer(outcome, { layout: 'indented' })

  expect(answer).toContain('\n  "kind": "summary"')
  expect(JSON.parse(answer)).toEqual(JSON.parse(renderAnswer(outcome, {})))
})

// Requirement: Any answer can be given in a form a program can read
// Scenario: The JSON answer stays on one line when no layout is asked for
// GIVEN a touched report and no layout asked for
// WHEN the answer is rendered
// THEN it is one line, which is what a program parses and what a pipe carries, so no script
//      reading the answer today notices the layout exists
it('keeps the JSON answer on one line when no layout is asked for', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())

  const answer = renderAnswer(await touched({ cwd: repo.root }), {})

  expect(answer.split('\n')).toHaveLength(1)
})

// Requirement: A command says which scenarios a change touched
// Scenario: The terminal form of one requirement says how to record either verdict
// GIVEN a change that touched a proof, and that requirement asked for as text
// WHEN the answer is rendered
// THEN it carries both commands that record a judgement, not only the question to judge by,
//      because the terminal form is the one a person reads and it is the person who otherwise
//      has to go and find out how to answer
it('says how to record either verdict in the terminal form of one requirement', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.write(TEST_PATH, bodyEdited())
  const outcome = await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } })

  const answer = renderAnswer(outcome, { format: 'text' })

  expect(answer).toContain(REVIEW_PROTOCOL.judge)
  expect(answer).toContain(REVIEW_PROTOCOL.pass)
  expect(answer).toContain(REVIEW_PROTOCOL.report)
})

// Requirement: A command says which scenarios a change touched
// Scenario: The terminal form of the lines that prove nothing carries them
// GIVEN a change to a helper beside the tests that no proof owns, asked for as text
// WHEN the answer is rendered
// THEN the changed line is in it as written, so the terminal form of this shape says what its
//      JSON says rather than pointing at a file for two lines
it('carries the lines that prove nothing in the terminal form', async () => {
  // Indented on purpose. A flush-left fixture cannot tell "as written" from "trimmed", which
  // is how a trim in the terminal form went unnoticed: the indentation is part of what changed.
  const helper = (value: number): string => `export const held = {\n  helper: ${value},\n}\n`
  const repo = await makeGitRepo({ ...inSync(), 'tests/support.ts': helper(1) })
  await repo.write('tests/support.ts', helper(2))
  const outcome = await touched({ cwd: repo.root, ask: { kind: 'unmatched' } })

  const answer = renderAnswer(outcome, { format: 'text' })

  expect(answer).toContain('tests/support.ts:2')
  expect(answer).toContain('      helper: 2,')
})

// Requirement: A command says which scenarios a change touched
// Scenario: Requirements come back in capability then requirement order
// GIVEN a change reaching three requirements that their files, their capabilities, and their
//       own names each order differently
// WHEN the work list is asked for
// THEN they come back by capability and then by requirement, rather than in the order the diff
//      arrived in — git lists what it tracks ahead of what it has never seen and then goes by
//      path, so the order a diff arrives in is not an order at all, and a report read again on
//      the next run has to be comparable with the last one
it('orders the work list by capability and then by requirement', async () => {
  // Three orders that disagree, so neither half of the sort can be dropped without failing
  // here. Files a, b, c hold zeta, alpha/Z, alpha/Y, so the path order the diff has already
  // applied is wrong; and the requirement names alphabetise A, Y, Z, which puts zeta's first
  // rather than last, so ordering on the requirement alone is wrong too.
  const zeta = testFile(['A zeta behavior'], { capability: 'zeta', requirement: 'A zeta promise' })
  const second = testFile(['A second behavior'], { capability: 'alpha', requirement: 'Z second alpha promise' })
  const first = testFile(['A first behavior'], { capability: 'alpha', requirement: 'Y first alpha promise' })
  const repo = await makeGitRepo({
    'specs/zeta.md': specFile({ capability: 'zeta', requirement: 'A zeta promise', recorded: [] }),
    'specs/alpha.md': specFile({ capability: 'alpha', requirement: 'Y first alpha promise', recorded: [] }),
    'tests/a.test.ts': zeta,
    'tests/b.test.ts': second,
    'tests/c.test.ts': first,
  })
  await repo.write('tests/a.test.ts', zeta.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))
  await repo.write('tests/b.test.ts', second.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))
  await repo.write('tests/c.test.ts', first.replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)'))

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements.map(one => [one.capability, one.requirement])).toEqual([
    ['alpha', 'Y first alpha promise'],
    ['alpha', 'Z second alpha promise'],
    ['zeta', 'A zeta promise'],
  ])
})
