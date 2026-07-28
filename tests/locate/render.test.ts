// Capability: locate

import { expect, it } from 'vitest'
import { renderSite } from '../../src/locate/index.ts'
import type { RenderedPage } from '../../src/locate/index.ts'
import type { CapabilitySpec } from '../../src/spec-file/index.ts'
import type { Step } from '../../src/test-scan/index.ts'
import { site } from './support.ts'

// A capability spec as `spec-file` hands it over: requirement prose plus the recorded
// scenarios (title + file, no steps, no line). The steps and the live line come from the
// sites, exactly as they do at run time.
function spec(fields: {
  readonly capability: string
  readonly requirement: string
  readonly description: string
  readonly scenarios: readonly { readonly scenario: string; readonly file: string }[]
}): CapabilitySpec {
  return {
    capability: fields.capability,
    requirements: [
      { requirement: fields.requirement, description: fields.description, scenarios: fields.scenarios },
    ],
  }
}

/** The content of the page at `path`, or '' when the site holds no such page. */
function page(pages: readonly RenderedPage[], path: string): string {
  return pages.find(one => one.path === path)?.content ?? ''
}

const ONE = spec({
  capability: 'locate',
  requirement: 'A requirement',
  description: 'The tool SHALL render.',
  scenarios: [{ scenario: 'A scenario', file: 'tests/x.test.ts' }],
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: A capability is rendered as its own page
// GIVEN two capabilities
// WHEN the site is rendered
// THEN each capability is a page of its own, named for the capability, so a static-site
//      explorer lists them one per capability
it('renders each capability as its own page', () => {
  const specs = [
    spec({ capability: 'alpha', requirement: 'R', description: 'The tool SHALL a.', scenarios: [{ scenario: 'a', file: 'tests/a.test.ts' }] }),
    spec({ capability: 'zebra', requirement: 'R', description: 'The tool SHALL z.', scenarios: [{ scenario: 'z', file: 'tests/z.test.ts' }] }),
  ]
  const sites = [
    site({ capability: 'alpha', requirement: 'R', scenario: 'a', file: 'tests/a.test.ts' }),
    site({ capability: 'zebra', requirement: 'R', scenario: 'z', file: 'tests/z.test.ts' }),
  ]

  const paths = renderSite(specs, sites, []).map(one => one.path)

  expect(paths).toContain('alpha.md')
  expect(paths).toContain('zebra.md')
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: The index links to every capability in name order
// GIVEN capabilities handed over out of name order
// WHEN the site is rendered
// THEN the index page links to each capability's page, in name order, so the reader has one
//      entry point regardless of the order the files were read in
it('renders an index linking to every capability in name order', () => {
  const specs = [
    spec({ capability: 'zebra', requirement: 'R', description: 'The tool SHALL z.', scenarios: [{ scenario: 'z', file: 'tests/z.test.ts' }] }),
    spec({ capability: 'alpha', requirement: 'R', description: 'The tool SHALL a.', scenarios: [{ scenario: 'a', file: 'tests/a.test.ts' }] }),
  ]
  const sites = [
    site({ capability: 'zebra', requirement: 'R', scenario: 'z', file: 'tests/z.test.ts' }),
    site({ capability: 'alpha', requirement: 'R', scenario: 'a', file: 'tests/a.test.ts' }),
  ]

  const index = page(renderSite(specs, sites, []), 'index.md')

  expect(index).toContain('[alpha](alpha.md)')
  expect(index).toContain('[zebra](zebra.md)')
  expect(index.indexOf('alpha.md')).toBeLessThan(index.indexOf('zebra.md'))
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: A scenario is rendered with its Gherkin steps
// GIVEN a capability recording a scenario, and the proof site carrying its GIVEN/WHEN/THEN steps
// WHEN the site is rendered
// THEN the capability's page shows each step as its keyword and text, under the scenario and
//      in GIVEN → WHEN → THEN order, the Gherkin pulled from the test not the committed file
it('renders a scenario with each of its Gherkin steps in order', () => {
  const steps: readonly Step[] = [
    { keyword: 'GIVEN', text: 'a scanned test file', line: 1 },
    { keyword: 'WHEN', text: 'the site is rendered', line: 2 },
    { keyword: 'THEN', text: 'each step appears under its scenario', line: 3 },
  ]
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/x.test.ts', line: 42, steps })]

  const content = page(renderSite([ONE], sites, []), 'locate.md')

  const heading = content.indexOf('### Scenario: A scenario')
  const given = content.indexOf('**GIVEN** a scanned test file')
  const when = content.indexOf('**WHEN** the site is rendered')
  const then = content.indexOf('**THEN** each step appears under its scenario')
  expect(heading).toBeGreaterThanOrEqual(0)
  expect(heading).toBeLessThan(given)
  expect(given).toBeLessThan(when)
  expect(when).toBeLessThan(then)
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: A requirement is rendered with its description
// GIVEN a capability whose requirement carries SHALL prose
// WHEN the site is rendered
// THEN the requirement heading on its page is followed by that prose, so a reader sees the
//      promise, not only its title
it('renders a requirement with its description prose after its heading', () => {
  const specs = [
    spec({
      capability: 'locate',
      requirement: 'A named promise',
      description: 'The tool SHALL keep the promise in plain sight.',
      scenarios: [{ scenario: 'A scenario', file: 'tests/x.test.ts' }],
    }),
  ]
  const sites = [site({ capability: 'locate', requirement: 'A named promise', scenario: 'A scenario' })]

  const content = page(renderSite(specs, sites, []), 'locate.md')

  const heading = content.indexOf('## Requirement: A named promise')
  const prose = content.indexOf('The tool SHALL keep the promise in plain sight.')
  expect(heading).toBeGreaterThanOrEqual(0)
  expect(heading).toBeLessThan(prose)
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: A scenario is rendered with its current position
// GIVEN a proof site proving a scenario at a file and a line
// WHEN the site is rendered
// THEN the scenario on its page carries that file and line, the live position a reader jumps
//      to rather than a stored one
it('renders a scenario with its current file and line', () => {
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/live.test.ts', line: 87 })]

  const content = page(renderSite([ONE], sites, []), 'locate.md')

  expect(content).toContain('tests/live.test.ts:87')
})

// Requirement: The spec is rendered as one page per capability with an index
// Scenario: A recorded scenario with no proof is rendered as unproven
// GIVEN a scenario recorded in a capability file that no proof site proves
// WHEN the site is rendered
// THEN the scenario is listed on its page with an unproven note and no steps, so drift is
//      shown rather than dropped or crashing the render
it('renders a recorded scenario with no proof as unproven', () => {
  const specs = [
    spec({
      capability: 'locate',
      requirement: 'A requirement',
      description: 'The tool SHALL render.',
      scenarios: [{ scenario: 'An orphaned scenario', file: 'tests/gone.test.ts' }],
    }),
  ]

  const content = page(renderSite(specs, [], []), 'locate.md')

  expect(content).toContain('### Scenario: An orphaned scenario')
  expect(content).toContain('Unproven — no test currently proves this scenario')
  expect(content).not.toContain('- **')
})

// Requirement: Each proof is rendered as an anchored code snippet its scenario links to
// Scenario: A proof is rendered as a code snippet
// GIVEN a test file carrying a proof site spanning some lines, and its source
// WHEN the site is rendered
// THEN the test's page holds a code snippet of exactly those proving lines, so the proof a
//      scenario points at can be read in the site itself
it('renders a proof as a code snippet of its lines', () => {
  const tests = [{ path: 'tests/x.test.ts', source: "it('a', () => {\n  expect(sum(2, 2)).toBe(4)\n})\nconst untouched = 1\n" }]
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/x.test.ts', line: 1, endLine: 3 })]

  const code = page(renderSite([ONE], sites, tests), 'tests/x.test.ts.md')

  expect(code).toContain('expect(sum(2, 2)).toBe(4)')
  expect(code).not.toContain('const untouched = 1')
})

// Requirement: Each proof is rendered as an anchored code snippet its scenario links to
// Scenario: A scenario links to the snippet that proves it
// GIVEN a scenario proven at a line in a test file
// WHEN the site is rendered
// THEN the scenario on its capability page links to that proof's `#l<line>` anchor, so the
//      reader is one click from the snippet that proves it
it('links a scenario to the anchored snippet that proves it', () => {
  const tests = [{ path: 'tests/x.test.ts', source: "it('a', () => {\n  expect(true).toBe(true)\n})\n" }]
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/x.test.ts', line: 2 })]

  const content = page(renderSite([ONE], sites, tests), 'locate.md')

  expect(content).toContain('[tests/x.test.ts:2](tests/x.test.ts#a-scenario)')
})

// Requirement: Each proof is rendered as an anchored code snippet its scenario links to
// Scenario: A snippet is headed by its scenario
// GIVEN a proof site proving a scenario in a test file
// WHEN the site is rendered
// THEN the snippet's heading on the code page is the scenario title, so its anchor reads as
//      the scenario the reader clicked rather than a bare line number
it('heads each snippet with its scenario title', () => {
  const tests = [{ path: 'tests/x.test.ts', source: "it('a', () => {\n  expect(true).toBe(true)\n})\n" }]
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/x.test.ts', line: 2 })]

  const code = page(renderSite([ONE], sites, tests), 'tests/x.test.ts.md')

  expect(code).toContain('## A scenario')
})

// Requirement: Each proof is rendered as an anchored code snippet its scenario links to
// Scenario: A snippet shows its scenario's Gherkin
// GIVEN a proof site carrying its scenario's GIVEN/WHEN/THEN steps
// WHEN the site is rendered
// THEN the snippet on the code page shows those steps above the code, so a reader can judge
//      the test against the claim without leaving the page
it("shows a scenario's Gherkin above its snippet", () => {
  const steps: readonly Step[] = [
    { keyword: 'GIVEN', text: 'a proof site', line: 1 },
    { keyword: 'THEN', text: 'the claim holds', line: 3 },
  ]
  const tests = [{ path: 'tests/x.test.ts', source: "it('a', () => {\n  expect(true).toBe(true)\n})\n" }]
  const sites = [site({ capability: 'locate', requirement: 'A requirement', scenario: 'A scenario', file: 'tests/x.test.ts', line: 2, steps })]

  const code = page(renderSite([ONE], sites, tests), 'tests/x.test.ts.md')

  const gherkin = code.indexOf('**GIVEN** a proof site')
  const proof = code.indexOf('```ts')
  expect(gherkin).toBeGreaterThanOrEqual(0)
  expect(code).toContain('**THEN** the claim holds')
  expect(gherkin).toBeLessThan(proof)
})
