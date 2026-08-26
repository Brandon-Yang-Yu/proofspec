// Capability: cli

import { afterEach, expect, it } from 'vitest'
import { exitCodeOf, touched } from '../../src/cli/index.ts'
import type { Outcome, TouchedRequirement, TouchedSummary } from '../../src/cli/index.ts'
import { requirementKey } from '../../src/review/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, REQUIREMENT, testFile, TEST_PATH } from './support.ts'

afterEach(cleanupRepos)

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'
const KEY = requirementKey({ capability: CAPABILITY, requirement: REQUIREMENT })

const BEFORE = 'The tool SHALL answer with one exchange of request and reply.'
const AFTER = 'The tool SHALL answer with one exchange, the reply quoted whole.'
const REWORDED = {
  kind: 'description-reworded',
  capability: CAPABILITY,
  requirement: REQUIREMENT,
  before: BEFORE,
  after: AFTER,
} as const

/**
 * The fixture's capability file, written with the description under judgement. No terms:
 * the description axis is measured here on its own, the way the term axis was.
 */
function specWithDescription(description: string): string {
  return [
    `# ${CAPABILITY}`,
    '',
    `### Requirement: ${REQUIREMENT}`,
    '',
    description,
    '',
    '<!-- scenarios: generated -->',
    `- "${FIRST}" → ${TEST_PATH}`,
    `- "${SECOND}" → ${TEST_PATH}`,
    '<!-- /scenarios -->',
    '',
  ].join('\n')
}

/** A repo committed in sync, whose capability file then rewords the description and nothing else moves. */
async function repoWithRewordedDescription() {
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specWithDescription(BEFORE),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  })
  await repo.write(`specs/${CAPABILITY}.md`, specWithDescription(AFTER))
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

// Requirement: A changed description counts as a change the tests did not make
// Scenario: A reworded description's PROMISE are in the work list and hold the gate
// GIVEN a repo committed in sync whose capability file then rewords one requirement's
//       description while the tests do not move a line
// WHEN the work list is asked for
// THEN the requirement is in it with every scenario of it pending, and the gate stays
//      shut, because the tests changing was never the only way a PROMISE could change
//      what it means
it("counts a reworded description's promises in the work list and holds the gate", async () => {
  const repo = await repoWithRewordedDescription()

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.requirements).toEqual([
    { key: KEY, capability: CAPABILITY, requirement: REQUIREMENT, scenarios: 2, gone: 0, pending: 2 },
  ])
  expect(exitCodeOf(await touched({ cwd: repo.root }))).toBe(1)
})

// Requirement: A changed description counts as a change the tests did not make
// Scenario: A scenario re-opened by a description carries the wording then and now
// GIVEN the same repo, with one of its re-opened promises fetched by address
// WHEN the requirement is read
// THEN each scenario carries the description the base revision held and the one that
//      stands now, because the distance the wording moved is the whole of what the
//      reviewer was asked
it('carries the description then and now on a scenario the description re-opened', async () => {
  const repo = await repoWithRewordedDescription()

  const report = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } }))

  expect(report.scenarios.map(one => one.changed)).toEqual(['description', 'description'])
  expect(report.scenarios.map(one => one.reopenedBy)).toEqual([[REWORDED], [REWORDED]])
})

// Requirement: A changed description counts as a change the tests did not make
// Scenario: A description the change left byte for byte unchanged re-opens nothing
// GIVEN a capability file whose requirements moved or were reordered since the base
//       revision with no description text changing
// WHEN the work list is asked for
// THEN no PROMISE under it is pending, because a description moved is the same
//      description
it('re-opens nothing when the descriptions did not change however the file moved', async () => {
  const OTHER = 'A second promise'
  const ANOTHER = 'A third behavior'
  const declaring = (order: 'declared' | 'reversed'): string => {
    const requirement = (name: string, description: string, scenario: string): readonly string[] => [
      `### Requirement: ${name}`,
      '',
      description,
      '',
      '<!-- scenarios: generated -->',
      `- "${scenario}" → ${TEST_PATH}`,
      '<!-- /scenarios -->',
    ]
    const main = requirement(REQUIREMENT, BEFORE, FIRST)
    const other = requirement(OTHER, 'The tool SHALL keep the exchange open.', ANOTHER)
    return ['# demo', '', ...(order === 'declared' ? [...main, '', ...other] : [...other, '', ...main]), ''].join('\n')
  }
  const tests = [`// Capability: ${CAPABILITY}`, '']
  for (const [scenario, requirement] of [[FIRST, REQUIREMENT], [ANOTHER, OTHER]] as const) {
    tests.push(
      `// Requirement: ${requirement}`,
      `// Scenario: ${scenario}`,
      '// THEN the demonstrated claim holds',
      `it(${JSON.stringify(scenario)}, () => {`,
      '  expect(true).toBe(true)',
      '})',
    )
  }
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: declaring('declared'),
    [TEST_PATH]: `${tests.join('\n')}\n`,
  })

  await repo.write(`specs/${CAPABILITY}.md`, declaring('reversed'))

  const summary = summaryOf(await touched({ cwd: repo.root }))
  expect(summary.requirements).toEqual([])
  expect(exitCodeOf(await touched({ cwd: repo.root })).valueOf()).toBe(0)
})

// Requirement: A changed description counts as a change the tests did not make
// Scenario: A PROMISE both a description change and a test change reached is gathered once
// GIVEN a repo whose capability file rewords one requirement's description while a line
//       of one of its tests also moves
// WHEN the requirement is fetched by address
// THEN the scenario whose test moved is gathered once carrying both what moved and the
//       description it is now judged under, because it is one PROMISE and one judgement
//       settles it
it('gathers a promise the description and the test both reached once', async () => {
  const committed = testFile([FIRST, SECOND])
  const moved = committed.replace(
    `it(${JSON.stringify(SECOND)}, () => {\n  expect(true).toBe(true)`,
    `it(${JSON.stringify(SECOND)}, () => {\n  expect(1 + 1).toBe(2)`,
  )
  const repo = await makeGitRepo({
    [`specs/${CAPABILITY}.md`]: specWithDescription(BEFORE),
    [TEST_PATH]: committed,
  })
  await repo.write(`specs/${CAPABILITY}.md`, specWithDescription(AFTER))
  await repo.write(TEST_PATH, moved)

  const report = requirementOf(await touched({ cwd: repo.root, ask: { kind: 'requirement', key: KEY } }))
  const touchedSecond = report.scenarios.filter(one => one.scenario === SECOND)

  expect(touchedSecond).toHaveLength(1)
  expect(touchedSecond[0]!.changed).toBe('proof')
  expect(touchedSecond[0]!.reopenedBy).toEqual([REWORDED])
})
