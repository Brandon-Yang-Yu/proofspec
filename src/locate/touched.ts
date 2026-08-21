import { compareStrings } from '../order.ts'
import type { ProofSite } from '../test-scan/index.ts'
import type { LineRange, TouchedScenario, TouchedScenarios } from './types.ts'

/**
 * The inverse of asking where a scenario is: given a file's proof sites and a set of its
 * lines, which scenarios did those lines touch?
 *
 * A proof spans more than its test. The claim sits *above* the code — the Gherkin comment
 * block comes before the `it(` — so the span a line is matched against runs from the first
 * step to the last line of the test. Matching the body alone would miss the change that
 * matters most: a rewritten GIVEN/WHEN/THEN is the promise itself changing, which is why a
 * touched scenario says which of the two the change reached.
 */
export function scenariosTouched(
  sites: readonly ProofSite[],
  ranges: readonly LineRange[],
): TouchedScenarios {
  const scenarios: TouchedScenario[] = []
  const matched = new Set<LineRange>()

  for (const site of sites) {
    // A site whose file declares no capability cannot be pointed at a requirement. `guard`
    // reports that gap; here it simply proves nothing, so its lines fall through as unmatched.
    if (site.capability === undefined) continue
    const span = spanOf(site)
    const hits = ranges.filter(range => range.from <= span.to && range.to >= span.from)
    if (hits.length === 0) continue
    for (const hit of hits) matched.add(hit)
    scenarios.push({
      capability: site.capability,
      requirement: site.requirement,
      scenario: site.scenario,
      file: site.file,
      from: span.from,
      to: span.to,
      // Anything starting above the tagged line is in the Gherkin, which is the claim.
      claim: hits.some(hit => hit.from < site.line) ? 'changed' : 'unchanged',
    })
  }

  return {
    scenarios: scenarios.sort(compareTouched),
    unmatched: ranges.filter(range => !matched.has(range)),
  }
}

/**
 * From the top of the proof's tag block to its last line: the `// Requirement:` and
 * `// Scenario:` lines, the Gherkin, and the code, as one span. A block site's shared steps
 * sit above its own tag, so they are counted too — rewriting the GIVEN a test shares changes
 * every scenario under it.
 */
function spanOf(site: ProofSite): LineRange {
  return { from: Math.min(site.tagLine, site.line, ...site.steps.map(step => step.line)), to: site.endLine }
}

/** Source order within a file, and by scenario when two proofs start on the same line. */
function compareTouched(a: TouchedScenario, b: TouchedScenario): number {
  return a.from - b.from || compareStrings(a.scenario, b.scenario)
}
