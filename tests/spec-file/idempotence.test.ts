// Capability: spec-file

import { expect, it } from 'vitest'
import { updateScenarioBlocks } from '../../src/spec-file/index.ts'
import type { RequirementNode } from '../../src/spec-tree/index.ts'
import { FENCE } from './support.ts'

/** Two requirements, one recorded by hand and one not, so a rewrite has both cases to hold. */
const ORDINARY = `# spec-file

Opening prose.

### Requirement: Written by hand

Its description.

### Requirement: Already recorded

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
<!-- /scenarios -->
`

/** A fence nobody closed: everything below it would be an example that runs off the end. */
const UNCLOSED_FENCE = `### Requirement: Written by hand

Its description shows the shape of an entry:

${FENCE}markdown
- "an example, not a real entry" → tests/example.test.ts
`

const RECORDED: readonly RequirementNode[] = [
  {
    requirement: 'Written by hand',
    scenarios: [{ scenario: 'is recorded now', file: 'tests/spec-file/new.test.ts' }],
  },
  {
    requirement: 'Already recorded',
    scenarios: [{ scenario: 'was recorded before', file: 'tests/spec-file/old.test.ts' }],
  },
]

// Requirement: Writing back twice changes nothing
// Scenario: Writing back a file that has just been written changes nothing
// GIVEN a capability file the write-back has just produced, written from a file of any
//       shape: an ordinary one, one that does not end in a newline, one holding a code
//       fence nobody closed
// WHEN the same write-back runs on it again
// THEN the file comes back byte for byte the same, so a repo the writer has just updated
//      does not fail the guard that regenerates it
it.each([
  { shape: 'an ordinary capability file', source: ORDINARY },
  { shape: 'a file with no trailing newline', source: ORDINARY.trimEnd() },
  { shape: 'a file holding a code fence nobody closed', source: UNCLOSED_FENCE },
])('leaves $shape byte for byte the same when written twice', ({ source }) => {
  const once = updateScenarioBlocks(source, { requirements: RECORDED })

  const twice = updateScenarioBlocks(once, { requirements: RECORDED })

  expect(twice).toBe(once)
})

// Requirement: Writing back twice changes nothing
// Scenario: Entries come out in title order whatever order they were given
// GIVEN entries handed to the write-back in an order other than by title
// WHEN the write-back runs
// THEN the block lists them in title order, so the same tests give the same file on any
//      machine however the tree was walked to reach them
it('writes entries in title order whatever order they arrive in', () => {
  const source = `### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  // "Zebra" before "apple": a capital sorts first by code unit and second in most locales,
  // so this pair fails if the order ever becomes the machine's rather than the tree's.
  const updated = updateScenarioBlocks(source, {
    requirements: [
      {
        requirement: 'Records where a scenario is',
        scenarios: [
          { scenario: 'apple is recorded second', file: 'tests/spec-file/write.test.ts' },
          { scenario: 'Zebra is recorded first', file: 'tests/spec-file/read.test.ts' },
        ],
      },
    ],
  })

  expect(updated).toBe(`### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
- "Zebra is recorded first" → tests/spec-file/read.test.ts
- "apple is recorded second" → tests/spec-file/write.test.ts
<!-- /scenarios -->
`)
})
