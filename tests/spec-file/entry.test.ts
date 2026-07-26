// Capability: spec-file

import { expect, it } from 'vitest'
import { readCapabilityFile, updateScenarioBlocks } from '../../src/spec-file/index.ts'
import { CAPABILITY, onlyRequirement } from './support.ts'

// Requirement: A generated block records where a scenario is, never what it claims
// Scenario: An entry is a title and a file on one line
// GIVEN one scenario to record under a requirement
// WHEN the write-back runs
// THEN the block holds one line carrying the scenario's title in quotation marks, an
//      arrow, and the file that proves it, with no line number and no Gherkin
it('records a scenario as its title and its file, and nothing more', () => {
  const source = `### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    {
      requirement: 'Records where a scenario is',
      scenarios: [{ scenario: 'An entry is a title and a file', file: 'tests/spec-file/entry.test.ts' }],
    },
  ] })

  expect(updated).toBe(`### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
- "An entry is a title and a file" → tests/spec-file/entry.test.ts
<!-- /scenarios -->
`)
})

// Requirement: A generated block records where a scenario is, never what it claims
// Scenario: A title holding the entry separator survives being written and read back
// GIVEN a scenario whose title holds the very characters that separate an entry's title
//       from its file
// WHEN it is written back and the result read again
// THEN the title comes back exactly as it was written above its test, because a title is
//      the scenario's identity and a mangled one is a different scenario
it('reads back a title holding the entry separator exactly as it was', () => {
  const title = 'A title with a " → inside it is read whole'
  const source = `### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    {
      requirement: 'Records where a scenario is',
      scenarios: [{ scenario: title, file: 'tests/spec-file/entry.test.ts' }],
    },
  ] })

  const reread = readCapabilityFile(updated, { capability: CAPABILITY })

  expect(onlyRequirement(reread).scenarios).toEqual([
    { scenario: title, file: 'tests/spec-file/entry.test.ts' },
  ])
})
