// Capability: locate

import { expect, it } from 'vitest'
import type { LineRange } from '../../src/locate/index.ts'
import { scenariosTouched } from '../../src/locate/index.ts'
import type { ProofSite, Step } from '../../src/test-scan/index.ts'
import { site } from './support.ts'

/** The Gherkin above a proof: two steps on the lines before the test opens. */
function stepsAbove(line: number): readonly Step[] {
  return [
    { keyword: 'GIVEN', text: 'a proof site', line: line - 2 },
    { keyword: 'THEN', text: 'the claim holds', line: line - 1 },
  ]
}

/** A proof whose tag opens on line 6, whose Gherkin sits on 8-9, and whose test runs 10-20. */
const PROOF = site({ scenario: 'A scenario', tagLine: 6, line: 10, endLine: 20, steps: stepsAbove(10) })

/**
 * Two scenarios proven inside one test, the layout that shares a GIVEN/WHEN:
 *
 * ```
 *  1  // GIVEN a document with one version    shared claim
 *  2  // WHEN a turn is posted                shared claim
 *  3  it('posting a turn', () => {            shared proof
 *  4    const res = post('/turn')             shared proof
 *  5
 *  6    // Requirement: A requirement         First's own claim
 *  7    // Scenario: First
 *  8    // THEN the reply streams
 *  9    expect(res).toBeOk()                  First's own proof
 * 10
 * 11    // Requirement: A requirement         Second's own claim
 * 12    // Scenario: Second
 * 13    // THEN a version is appended
 * 14    const versions = list()               Second's own proof
 * 15    expect(versions).toHaveLength(2)
 * 16  })
 * ```
 */
const SHARED: readonly Step[] = [
  { keyword: 'GIVEN', text: 'a document with one version', line: 1 },
  { keyword: 'WHEN', text: 'a turn is posted', line: 2 },
]
const FIRST = site({
  scenario: 'First',
  testLine: 3,
  tagLine: 6,
  line: 9,
  endLine: 9,
  steps: [...SHARED, { keyword: 'THEN', text: 'the reply streams', line: 8 }],
})
const SECOND = site({
  scenario: 'Second',
  testLine: 3,
  tagLine: 11,
  line: 14,
  endLine: 15,
  steps: [...SHARED, { keyword: 'THEN', text: 'a version is appended', line: 13 }],
})
const BLOCKS: readonly ProofSite[] = [FIRST, SECOND]

/**
 * A block whose shared GIVEN runs onto a second line, so the steps above the test end two
 * lines before it opens:
 *
 * ```
 *  1  // GIVEN a document that has been through a great many
 *  2  //       revisions already
 *  3
 *  4  it('posting a turn', () => {
 * ```
 */
const WRAPPED = site({
  scenario: 'Wrapped',
  testLine: 4,
  tagLine: 6,
  line: 8,
  endLine: 8,
  steps: [
    { keyword: 'GIVEN', text: 'a document that has been through a great many revisions already', line: 1 },
    { keyword: 'THEN', text: 'the reply streams', line: 7 },
  ],
})

/** What a report says, read down to the two things these scenarios are about. */
function named(
  sites: readonly ProofSite[],
  ranges: readonly LineRange[],
): { scenario: string; changed: string }[] {
  return scenariosTouched(sites, ranges).scenarios.map(one => ({ scenario: one.scenario, changed: one.changed }))
}

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change in the Gherkin alone says the claim changed
// GIVEN a proof whose Gherkin sits above its test, and a change reaching only those steps
// WHEN the touched scenarios are found
// THEN the report names the scenario with its claim changed, because the promise was
//      rewritten and the evidence was left alone
it('says the claim changed when only the Gherkin moved', () => {
  expect(named([PROOF], [{ from: 9, to: 9 }])).toEqual([{ scenario: 'A scenario', changed: 'claim' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change in the test body alone says the proof changed
// GIVEN a proof whose Gherkin sits above its test, and a change reaching only its code
// WHEN the touched scenarios are found
// THEN the report names the scenario with its proof changed, because the evidence moved
//      and the promise above it has not caught up
it('says the proof changed when only the test body moved', () => {
  expect(named([PROOF], [{ from: 14, to: 14 }])).toEqual([{ scenario: 'A scenario', changed: 'proof' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change reaching the Gherkin and the body says both changed
// GIVEN a proof whose Gherkin sits above its test, and changes reaching the steps and the code
// WHEN the touched scenarios are found
// THEN the report names the scenario with both changed, because an author who moved the two
//      together is a different case from one who moved only one
it('says both changed when the Gherkin and the body moved together', () => {
  expect(named([PROOF], [{ from: 9, to: 9 }, { from: 14, to: 14 }])).toEqual([
    { scenario: 'A scenario', changed: 'both' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change in one block's own Gherkin names that block alone
// GIVEN a test proving two scenarios, and a change reaching the first block's own THEN
// WHEN the touched scenarios are found
// THEN the report names that block alone with its claim changed, because the steps a block
//      writes for itself are no part of what its siblings promise
it('names one block alone when its own Gherkin moved', () => {
  expect(named(BLOCKS, [{ from: 8, to: 8 }])).toEqual([{ scenario: 'First', changed: 'claim' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change in one block's own code says its proof changed
// GIVEN a test proving two scenarios, and a change reaching the first block's own statement
// WHEN the touched scenarios are found
// THEN the report names that block alone with its proof changed, because the lines a block
//      runs for itself prove nothing its siblings claim
it('names one block alone when its own code moved', () => {
  expect(named(BLOCKS, [{ from: 9, to: 9 }])).toEqual([{ scenario: 'First', changed: 'proof' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change reaching both halves of one block says both changed
// GIVEN a test proving two scenarios, and changes reaching one block's own THEN and its statement
// WHEN the touched scenarios are found
// THEN the report names that block alone with both changed, so a block carries the three
//      states its own way round, unaffected by what it shares
it('says both changed when one block moved its own halves together', () => {
  expect(named(BLOCKS, [{ from: 8, to: 8 }, { from: 9, to: 9 }])).toEqual([
    { scenario: 'First', changed: 'both' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A step shared above the blocks changes the claim of every scenario in the test
// GIVEN a test proving two scenarios under a shared GIVEN, and a change reaching that step
// WHEN the touched scenarios are found
// THEN both scenarios are named with their claim changed, because a shared step is part of
//      every sentence written under it
it('changes the claim of every scenario when a shared step moved', () => {
  expect(named(BLOCKS, [{ from: 1, to: 1 }])).toEqual([
    { scenario: 'First', changed: 'claim' },
    { scenario: 'Second', changed: 'claim' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: Setup shared above the blocks changes the proof of every scenario in the test
// GIVEN a test proving two scenarios after a shared setup, and a change reaching that setup
// WHEN the touched scenarios are found
// THEN both scenarios are named with their proof changed, because the shared action is part
//      of how every one of them is proven, and no part of what any of them promises
it('changes the proof of every scenario when shared setup moved', () => {
  expect(named(BLOCKS, [{ from: 4, to: 4 }])).toEqual([
    { scenario: 'First', changed: 'proof' },
    { scenario: 'Second', changed: 'proof' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change reaching both shared halves changes both for every scenario in the test
// GIVEN a test proving two scenarios, and changes reaching the shared step and the shared setup
// WHEN the touched scenarios are found
// THEN both scenarios are named with both changed, because what a test shares is shared in
//      the two directions at once
it('changes both for every scenario when the shared halves moved together', () => {
  expect(named(BLOCKS, [{ from: 1, to: 1 }, { from: 4, to: 4 }])).toEqual([
    { scenario: 'First', changed: 'both' },
    { scenario: 'Second', changed: 'both' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A line changed outside every proof is reported as matching none
// GIVEN a changed line that falls in no proof site
// WHEN the touched scenarios are found
// THEN no scenario is named and the line comes back as unmatched, because a helper or an
//      import is a real change with no promise behind it
it('reports a changed line that falls in no proof as unmatched', () => {
  const { scenarios, unmatched } = scenariosTouched([PROOF], [{ from: 3, to: 4 }])

  expect(scenarios).toEqual([])
  expect(unmatched).toEqual([{ from: 3, to: 4 }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A scenario is named once however many changed lines fall in it
// GIVEN three changed runs of lines, all inside one proof
// WHEN the touched scenarios are found
// THEN the scenario is named once, so a reader sees a promise touched, not a diff retold
it('names a scenario once however many changed lines fall in it', () => {
  const { scenarios } = scenariosTouched([PROOF], [{ from: 9, to: 9 }, { from: 12, to: 13 }, { from: 19, to: 20 }])

  expect(scenarios).toHaveLength(1)
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A proof with no capability names no scenario
// GIVEN a proof site whose file declares no capability, and a changed line inside it
// WHEN the touched scenarios are found
// THEN no scenario is named and the line is unmatched, because a site with no capability
//      cannot be pointed at a requirement — the check reports that gap on its own
it('names no scenario for a proof whose file declares no capability', () => {
  // Built here rather than through `site`, whose default capability is a real one — the
  // point of this scenario is a file that declares none.
  const untagged: ProofSite = {
    capability: undefined,
    requirement: 'A requirement',
    scenario: 'A scenario',
    steps: [],
    file: 'tests/untagged.test.ts',
    tagLine: 10,
    line: 10,
    testLine: 10,
    endLine: 20,
  }

  const { scenarios, unmatched } = scenariosTouched([untagged], [{ from: 12, to: 12 }])

  expect(scenarios).toEqual([])
  expect(unmatched).toEqual([{ from: 12, to: 12 }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A change to the line a scenario is named on says the claim changed
// GIVEN a proof whose `// Scenario:` tag sits above its Gherkin, and a change to that tag
// WHEN the touched scenarios are found
// THEN the scenario is named with its claim changed, because a site starts where its claim is
//      written and renaming a scenario is the plainest rewrite of a promise there is
it('says the claim changed when the line naming the scenario moved', () => {
  expect(named([PROOF], [{ from: 6, to: 6 }])).toEqual([{ scenario: 'A scenario', changed: 'claim' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A block reports the line its own tag opens on, not the prelude it shares
// GIVEN a test proving two scenarios, and a change reaching the second block's own code
// WHEN the touched scenarios are found
// THEN the scenario reports the line its own tag opens on, so a reader is sent to the promise
//      named rather than to the prelude every scenario in that test shares
it('reports where a block opens, not where its shared prelude does', () => {
  const { scenarios } = scenariosTouched(BLOCKS, [{ from: 14, to: 14 }])

  expect(scenarios).toEqual([
    {
      capability: 'locate',
      requirement: 'A requirement',
      scenario: 'Second',
      file: SECOND.file,
      from: 11,
      to: 15,
      changed: 'proof',
      claim: SECOND.steps,
      proves: [{ from: 3, to: 5 }, { from: 14, to: 15 }],
    },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: The line between two blocks belongs to the block above it
// GIVEN a test proving two scenarios, and a change to the blank line separating them
// WHEN the touched scenarios are found
// THEN the block above is named, because a block runs to the line before the next block's claim
//      opens rather than stopping at its own last statement and leaving a line proving nothing
it('gives the line between two blocks to the block above it', () => {
  expect(named(BLOCKS, [{ from: 10, to: 10 }])).toEqual([{ scenario: 'First', changed: 'proof' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A shared step is claim down to the line the test opens on
// GIVEN a block whose shared GIVEN runs onto a second line before its test opens
// WHEN the touched scenarios are found
// THEN a change to that second line says the claim changed, because the shared steps are a run
//      down to the test rather than the lines their keywords sit on
it('counts a shared step as claim where its text runs on', () => {
  expect(named([WRAPPED], [{ from: 2, to: 2 }])).toEqual([{ scenario: 'Wrapped', changed: 'claim' }])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A line that reached a proof is not also reported as matching none
// GIVEN a change reaching only the code of a proof
// WHEN the touched scenarios are found
// THEN no line comes back unmatched, because a line cannot both prove something and prove
//      nothing, and the proof side of a site counts as reaching it just as its claim does
it('does not report a line as unmatched when it reached a proof', () => {
  const { unmatched } = scenariosTouched([PROOF], [{ from: 14, to: 14 }])

  expect(unmatched).toEqual([])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A touched scenario carries the Gherkin it claims
// GIVEN a test proving two scenarios under a shared GIVEN, and a change reaching the first
// WHEN the touched scenarios are found
// THEN the scenario carries every step of its claim, the ones its test shares included, so a
//      reader judging it against its proof has the whole sentence without opening the file
it('carries the whole claim, the steps its test shares included', () => {
  const { scenarios } = scenariosTouched(BLOCKS, [{ from: 9, to: 9 }])

  expect(scenarios.map(one => one.claim)).toEqual([
    [
      { keyword: 'GIVEN', text: 'a document with one version', line: 1 },
      { keyword: 'WHEN', text: 'a turn is posted', line: 2 },
      { keyword: 'THEN', text: 'the reply streams', line: 8 },
    ],
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A touched scenario names the lines that prove it
// GIVEN a test proving two scenarios, and a change reaching the first
// WHEN the touched scenarios are found
// THEN the lines named are the setup its test shares and its own statements, and no line of
//      its sibling, because evidence for another scenario is the wrong thing to judge it by
it('names the lines that prove a scenario and none that prove its sibling', () => {
  const { scenarios } = scenariosTouched(BLOCKS, [{ from: 9, to: 9 }])

  expect(scenarios.map(one => one.proves)).toEqual([[{ from: 3, to: 5 }, { from: 9, to: 10 }]])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: Every part of a changed run that no proof owns is reported
// GIVEN one run of changed lines opening above one proof, running through a second, and ending
//       below it, so that the lines no proof owns sit before, between, and after them
// WHEN the touched scenarios are found
// THEN all three parts come back unmatched, because a run of changed lines is not all one
//      promise, and every stretch of it that proved nothing is a change with nothing behind it
it('reports every part of a changed run that reached no proof', () => {
  const second = site({ scenario: 'A second scenario', tagLine: 26, line: 30, endLine: 40, steps: stepsAbove(30) })

  const { unmatched } = scenariosTouched([PROOF, second], [{ from: 4, to: 45 }])

  expect(unmatched).toEqual([{ from: 4, to: 5 }, { from: 21, to: 25 }, { from: 41, to: 45 }])
})
