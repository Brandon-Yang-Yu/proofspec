// Capability: spec-file

import { expect, it } from 'vitest'
import { updateScenarioBlocks } from '../../src/spec-file/index.ts'
import { FENCE } from './support.ts'

// Requirement: Writing back touches only the generated block
// Scenario: Everything outside the generated blocks comes back unchanged
// GIVEN a capability file with opening prose, blank lines and two requirements, each
//       already carrying a generated block
// WHEN the write-back runs with different entries
// THEN the file comes back differing only between the markers, so headings, descriptions,
//      wording and blank lines are all exactly as they were
it('changes nothing outside the generated blocks', () => {
  const source = `# spec-file

Opening   prose,  loosely   spaced on purpose.

### Requirement: First

Its description.

A second paragraph.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
<!-- /scenarios -->

### Requirement: Second

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    { requirement: 'First', scenarios: [{ scenario: 'is recorded now', file: 'tests/spec-file/new.test.ts' }] },
    { requirement: 'Second', scenarios: [{ scenario: 'is recorded too', file: 'tests/spec-file/new.test.ts' }] },
  ] })

  expect(updated).toBe(`# spec-file

Opening   prose,  loosely   spaced on purpose.

### Requirement: First

Its description.

A second paragraph.

<!-- scenarios: generated -->
- "is recorded now" → tests/spec-file/new.test.ts
<!-- /scenarios -->

### Requirement: Second

Its description.

<!-- scenarios: generated -->
- "is recorded too" → tests/spec-file/new.test.ts
<!-- /scenarios -->
`)
})

// Requirement: Writing back touches only the generated block
// Scenario: A requirement with no block is given one after its description
// GIVEN a requirement written with a description and no generated block, followed by
//       another requirement that has one
// WHEN the write-back runs, whether it hands the hand-written requirement an entry or
//      nothing at all
// THEN its generated block sits between its description and the next heading — holding the
//      entry when there was one and empty when there was none, since an empty block is
//      still what a requirement nothing proves yet looks like — so the block a hand-written
//      requirement lacks is the one thing added either way
it.each([
  {
    handed: 'an entry',
    scenarios: [{ scenario: 'is recorded now', file: 'tests/spec-file/new.test.ts' }],
    block: '<!-- scenarios: generated -->\n- "is recorded now" → tests/spec-file/new.test.ts\n<!-- /scenarios -->',
  },
  {
    handed: 'nothing',
    scenarios: [],
    block: '<!-- scenarios: generated -->\n<!-- /scenarios -->',
  },
])('gives a requirement with no block one after its description, handed $handed', ({ scenarios, block }) => {
  const source = `### Requirement: Written by hand

Its description.

### Requirement: Already recorded

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    { requirement: 'Written by hand', scenarios },
    { requirement: 'Already recorded', scenarios: [{ scenario: 'was recorded before', file: 'tests/spec-file/old.test.ts' }] },
  ] })

  expect(updated).toBe(`### Requirement: Written by hand

Its description.

${block}

### Requirement: Already recorded

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
<!-- /scenarios -->
`)
})

// Requirement: Writing back touches only the generated block
// Scenario: A generated block inside a fenced code block is left alone
// GIVEN a requirement whose description shows an example generated block inside a fenced
//       code block, before the requirement's own block
// WHEN the write-back runs
// THEN the file comes back with the example inside the fence untouched and the entry
//      written into the requirement's own block. A marker inside a fence is not a marker,
//      so the block the requirement owns is the only one there was to write
it('leaves a generated block inside a code fence alone', () => {
  const source = `### Requirement: The real one

Its description shows what a recorded block looks like:

${FENCE}markdown
<!-- scenarios: generated -->
- "an example, not a real entry" → tests/example.test.ts
<!-- /scenarios -->
${FENCE}

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    { requirement: 'The real one', scenarios: [{ scenario: 'is recorded now', file: 'tests/spec-file/new.test.ts' }] },
  ] })

  expect(updated).toBe(`### Requirement: The real one

Its description shows what a recorded block looks like:

${FENCE}markdown
<!-- scenarios: generated -->
- "an example, not a real entry" → tests/example.test.ts
<!-- /scenarios -->
${FENCE}

<!-- scenarios: generated -->
- "is recorded now" → tests/spec-file/new.test.ts
<!-- /scenarios -->
`)
})

// Requirement: Writing back touches only the generated block
// Scenario: A requirement nothing proves any more is left with an empty block
// GIVEN a capability file recording two entries for a requirement
// WHEN the write-back runs with no entries for it, whether the requirement is absent from
//      what it was handed or present there with nothing under it
// THEN its block comes back empty, which is what a requirement looks like when nothing
//      proves it and what the guard then reports as uncovered
it.each([
  { handed: 'nothing at all', requirements: [] },
  {
    handed: 'the requirement with no entries under it',
    requirements: [{ requirement: 'Nothing proves this any more', scenarios: [] }],
  },
])('empties the block of a requirement handed $handed', ({ requirements }) => {
  const source = `### Requirement: Nothing proves this any more

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
- "was recorded before too" → tests/spec-file/old.test.ts
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements })

  expect(updated).toBe(`### Requirement: Nothing proves this any more

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`)
})

// Requirement: Writing back touches only the generated block
// Scenario: An opening marker with no closing one is written back closed
// GIVEN a generated block whose closing marker has been lost, its entries running to the
//       blank line before the next heading
// WHEN the write-back runs
// THEN the block comes back closed, its entries replaced, and the blank line before the
//      next heading still there, so a file that lost a marker comes to rest instead of
//      gaining a block on every run
it('closes a generated block whose closing marker was lost', () => {
  const source = `### Requirement: Lost its marker

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts

### Requirement: Intact

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, {
    requirements: [
      { requirement: 'Lost its marker', scenarios: [{ scenario: 'is recorded now', file: 'tests/spec-file/new.test.ts' }] },
    ],
  })

  expect(updated).toBe(`### Requirement: Lost its marker

Its description.

<!-- scenarios: generated -->
- "is recorded now" → tests/spec-file/new.test.ts
<!-- /scenarios -->

### Requirement: Intact

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->
`)
})

// Requirement: Writing back touches only the generated block
// Scenario: A file that declares no requirements comes back unchanged
// GIVEN a capability file that is all opening prose and declares no requirement heading
// WHEN the write-back runs, even handed entries for requirements the file never declares
// THEN the file comes back byte for byte, because with no heading to own a block there is
//      nothing the write-back may touch
it('leaves a file that declares no requirements unchanged', () => {
  const source = `# spec-file

Opening prose about the capability, and not one requirement declared yet.
`

  const updated = updateScenarioBlocks(source, { requirements: [
    { requirement: 'Never declared', scenarios: [{ scenario: 'has nowhere to go', file: 'tests/spec-file/new.test.ts' }] },
  ] })

  expect(updated).toBe(source)
})

// Requirement: Writing back touches only the generated block
// Scenario: Entries for a requirement the file does not declare are not written
// GIVEN entries for a requirement the file declares no heading for, alongside entries
//       that match what the file already records
// WHEN the write-back runs
// THEN the file comes back unchanged, because the heading is the human's half of the file
//      and the tool never authors one
it('writes nothing for a requirement the file does not declare', () => {
  const source = `### Requirement: Declared

Its description.

<!-- scenarios: generated -->
- "was recorded before" → tests/spec-file/old.test.ts
<!-- /scenarios -->
`

  const updated = updateScenarioBlocks(source, { requirements: [
    { requirement: 'Declared', scenarios: [{ scenario: 'was recorded before', file: 'tests/spec-file/old.test.ts' }] },
    { requirement: 'Never declared', scenarios: [{ scenario: 'has nowhere to go', file: 'tests/spec-file/new.test.ts' }] },
  ] })

  expect(updated).toBe(source)
})
