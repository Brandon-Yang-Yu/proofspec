// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { exitCodeOf, review, touched } from '../../src/cli/index.ts'
import type { Outcome, TouchedRequirement, TouchedSummary } from '../../src/cli/index.ts'
import { requirementKey } from '../../src/review/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, REQUIREMENT, testFile, TEST_PATH } from './support.ts'

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'
const KEY = requirementKey({ capability: CAPABILITY, requirement: REQUIREMENT })

const BEFORE = 'One exchange of request and reply.'
const AFTER = 'One exchange, reply included.'
const REDEFINED = { kind: 'reworded', term: 'TURN', before: BEFORE, after: AFTER } as const

/**
 * The fixture's capability file, with the definition it is written with. The requirement's
 * standard uses the term, so redefining it is a change to what that standard means.
 */
function specWithTerm(definition: string): string {
  return [
    `# ${CAPABILITY}`,
    '',
    '### Term: TURN',
    '',
    definition,
    '',
    `### Requirement: ${REQUIREMENT}`,
    '',
    'The tool SHALL answer every TURN.',
    '',
    '<!-- scenarios: generated -->',
    `- "${FIRST}" → ${TEST_PATH}`,
    `- "${SECOND}" → ${TEST_PATH}`,
    '<!-- /scenarios -->',
    '',
  ].join('\n')
}

/** A repo committed in sync, whose capability file then redefines TURN and nothing else moves. */
async function repoWithRedefinedTerm() {
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specWithTerm(BEFORE),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  })
  await repo.write(`specs/${CAPABILITY}.md`, specWithTerm(AFTER))
  return repo
}

/** The work list an outcome carries. */
function summaryOf(outcome: Outcome): TouchedSummary {
  if (outcome.kind !== 'touched' || outcome.report.kind !== 'summary') {
    throw new Error(`expected the work list, got ${outcome.kind}`)
  }
  return outcome.report
}

/** One requirement as the report carries it, asked for by its address. */
function requirementOf(outcome: Outcome): TouchedRequirement {
  if (outcome.kind !== 'touched' || outcome.report.kind !== 'requirement') {
    throw new Error(`expected one requirement, got ${outcome.kind}`)
  }
  return outcome.report
}

// Requirement: A changed TERM counts as a change the tests did not make
// Scenario: A changed TERM's PROMISE are in the work list and hold the gate
// GIVEN a repo committed in sync whose CAPABILITY FILE then redefines TURN while the tests
//       do not move a line
// WHEN the work list is asked for
// THEN the requirement whose STANDARD uses TURN is in it with both its PROMISE pending,
//      and the gate stays shut, because the tests changing was never the only way a
//      PROMISE could change what it means
it("counts a redefined term's promises in the work list and holds the gate", async () => {
  const repo = await repoWithRedefinedTerm()

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements).toEqual([
    { key: KEY, capability: CAPABILITY, requirement: REQUIREMENT, scenarios: 2, gone: 0, pending: 2 },
  ])
  expect(exitCodeOf(await touched({ cwd: repo.root }))).toBe(1)
})

// Requirement: A changed TERM counts as a change the tests did not make
// Scenario: A scenario re-opened by a TERM carries the definition it is now judged under
// GIVEN the same repo, with one of its re-opened PROMISE fetched by address
// WHEN the requirement is read
// THEN each scenario carries TURN with the definition the base revision held and the one
//      that stands now, because the distance the meaning moved is the whole of what the
//      reviewer was asked about
it('carries the definition then and now on a scenario a term re-opened', async () => {
  const repo = await repoWithRedefinedTerm()

  const report = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } }))

  expect(report.scenarios.map(one => one.reopenedBy)).toEqual([[REDEFINED], [REDEFINED]])
})

// Requirement: A changed TERM counts as a change the tests did not make
// Scenario: A PROMISE both axes reached is gathered once, carrying the TERM changes with it
// GIVEN a repo committed in sync whose CAPABILITY FILE then redefines TURN while a line of
//       one of the tests it governs also moves
// WHEN the requirement is fetched by address
// THEN the scenario whose test moved is gathered once, carrying both what moved in its
//      file and the TERM changes that re-opened it, because it is one PROMISE and one
//      judgement settles it
it('gathers a promise both axes reached once, with the term changes on it', async () => {
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specWithTerm(BEFORE),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  })
  await repo.write(`specs/${CAPABILITY}.md`, specWithTerm(AFTER))
  await repo.write(TEST_PATH, testFile([FIRST, 'A second behavior, reworded']))

  const report = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } }))
  const reworded = report.scenarios.filter(one => one.scenario === 'A second behavior, reworded')

  expect(reworded).toHaveLength(1)
  expect(reworded[0]!.changed).toBe('both')
  expect(reworded[0]!.reopenedBy).toEqual([REDEFINED])
})

// Requirement: A changed TERM counts as a change the tests did not make
// Scenario: A PROMISE re-opened through another TERM's definition keys the definition it never names
// GIVEN a repo whose TERM MARGIN is defined through REPLY, a PROMISE whose STANDARD names
//       MARGIN only, REPLY redefined once, and a review filed against the re-opened PROMISE
// WHEN REPLY is redefined again
// THEN the PROMISE is pending again and the gate holds, because the judgement stood against
//      a STANDARD that no longer stands — the PROMISE never named REPLY, but its meaning
//      moved with REPLY all the same
it("re-keys a promise through another term's definition", async () => {
  const specThrough = (reply: string) =>
    [
      `# ${CAPABILITY}`,
      '',
      '### Term: MARGIN',
      '',
      'The space a REPLY is written in.',
      '',
      '### Term: REPLY',
      '',
      reply,
      '',
      `### Requirement: ${REQUIREMENT}`,
      '',
      'The tool SHALL hold the MARGIN open.',
      '',
      '<!-- scenarios: generated -->',
      `- "${FIRST}" → ${TEST_PATH}`,
      `- "${SECOND}" → ${TEST_PATH}`,
      '<!-- /scenarios -->',
      '',
    ].join('\n')

  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specThrough('The answer half.'),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  })
  await repo.write(`specs/${CAPABILITY}.md`, specThrough('The answer half, quoted.'))
  const reOpened = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } }))
  const judged = await review({
    cwd: repo.root,
    review: { key: reOpened.scenarios[0]!.key, verdict: 'ok', proves: 7, by: 'a reviewer', note: undefined },
  })
  expect(judged.kind).toBe('reviewed')
  expect(summaryOf(await touched({ cwd: repo.root })).requirements[0]!.pending).toBe(1)

  await repo.write(`specs/${CAPABILITY}.md`, specThrough('The answer half, quoted and dated.'))

  const summary = summaryOf(await touched({ cwd: repo.root }))
  expect(summary.requirements[0]!.pending).toBe(2)
  expect(exitCodeOf(await touched({ cwd: repo.root }))).toBe(1)
})
