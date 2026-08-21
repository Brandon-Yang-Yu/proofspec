// Capability: locate

import { expect, it } from 'vitest'
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

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A line changed inside a proof names the scenario it proves
// GIVEN a proof spanning some lines, and a changed line inside its test body
// WHEN the touched scenarios are found
// THEN the scenario is named, and the claim is reported unchanged, because the change
//      reached the proof and not the promise
it('names the scenario a changed line inside its test body proves', () => {
  const { scenarios } = scenariosTouched([PROOF], [{ from: 14, to: 14 }])

  expect(scenarios).toEqual([
    { capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: PROOF.file, from: 6, to: 20, claim: 'unchanged' },
  ])
})

// Requirement: The scenarios proven at a set of lines can be found
// Scenario: A line changed in the Gherkin above a proof says the claim changed
// GIVEN a proof whose Gherkin sits above its test, and a changed line among those steps
// WHEN the touched scenarios are found
// THEN the scenario is named with its claim reported changed, so a rewritten promise is
//      told apart from a rewritten proof
it('reports the claim changed when the change reaches the Gherkin', () => {
  const { scenarios } = scenariosTouched([PROOF], [{ from: 9, to: 9 }])

  expect(scenarios.map(one => one.claim)).toEqual(['changed'])
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
    endLine: 20,
  }

  const { scenarios, unmatched } = scenariosTouched([untagged], [{ from: 12, to: 12 }])

  expect(scenarios).toEqual([])
  expect(unmatched).toEqual([{ from: 12, to: 12 }])
})
