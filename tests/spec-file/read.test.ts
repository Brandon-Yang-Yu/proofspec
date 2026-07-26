// Capability: spec-file

import { expect, it } from 'vitest'
import { readCapabilityFile } from '../../src/spec-file/index.ts'
import { CAPABILITY, FENCE, entriesOf, onlyRequirement, requirementNames } from './support.ts'

// Requirement: Reading a file yields its requirements and what they record
// Scenario: A requirement's description and its recorded entries are read together
// GIVEN a capability file whose opening prose is followed by a requirement, its
//       description, and a generated block holding two entries
// WHEN the file is read
// THEN one requirement comes back, carrying the description written beneath its heading
//      and the two entries it records, each entry a scenario title and the file that
//      proves it
it('reads a requirement with its description and its entries', () => {
  const source = `# spec-file

Opening prose about the capability, belonging to no requirement.

### Requirement: Reading a file yields its requirements and what they record

Reading a capability file gives back each heading and what it records.

A second paragraph of the same description.

<!-- scenarios: generated -->
- "A block that records nothing reads as empty" → tests/spec-file/read.test.ts
- "An entry is a title and a file" → tests/spec-file/entry.test.ts
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  expect(spec).toEqual({
    capability: 'spec-file',
    requirements: [
      {
        requirement: 'Reading a file yields its requirements and what they record',
        description:
          'Reading a capability file gives back each heading and what it records.\n\n' +
          'A second paragraph of the same description.',
        scenarios: [
          { scenario: 'A block that records nothing reads as empty', file: 'tests/spec-file/read.test.ts' },
          { scenario: 'An entry is a title and a file', file: 'tests/spec-file/entry.test.ts' },
        ],
      },
    ],
  })
})

// Requirement: Reading a file yields its requirements and what they record
// Scenario: A requirement that records nothing reads as one with no entries
// GIVEN a requirement that records nothing, either because its generated block is empty
//       or because it has no block at all
// WHEN the file is read
// THEN it comes back as a requirement with no entries, which is what one looks like
//      before anything proves it
it.each([
  { records: 'an empty generated block', block: '<!-- scenarios: generated -->\n<!-- /scenarios -->\n' },
  { records: 'no generated block at all', block: '' },
])('reads a requirement with $records as one with no entries', ({ block }) => {
  const source = `### Requirement: Nothing proves this yet

Its description.

${block}`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  expect(onlyRequirement(spec).scenarios).toEqual([])
})

// Requirement: Reading a file yields its requirements and what they record
// Scenario: A heading inside a fenced code block is not a requirement
// GIVEN a capability file whose description shows an example requirement heading inside a
//       fenced code block
// WHEN the file is read
// THEN only the real requirement comes back, because a file showing an example of itself
//      must not be read as if the example were real
it('does not read a heading inside a code fence as a requirement', () => {
  const source = `### Requirement: The real one

Its description shows the shape of a capability file:

${FENCE}markdown
### Requirement: The example one

Its description.
${FENCE}

<!-- scenarios: generated -->
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  expect(requirementNames(spec)).toEqual(['The real one'])
})

// GIVEN a capability file that declares its requirements in an order other than by name,
//       one of them recording its entries in an order other than by title
// WHEN the file is read
it('reads a file into the order the tree uses', () => {
  // "Zebra" before "apple": a capital sorts first by code unit and second in most locales,
  // so this pair fails if the order ever becomes the machine's rather than the tree's.
  const source = `### Requirement: apple

Its description.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Zebra

Its description.

<!-- scenarios: generated -->
- "apple is recorded second" → tests/spec-file/write.test.ts
- "Zebra is recorded first" → tests/spec-file/read.test.ts
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  // Requirement: Reading a file yields its requirements and what they record
  // Scenario: Requirements come back in name order, not the file's order
  // THEN the requirements come back in name order, which is the order the tree uses, so
  //      what was read is already a branch of it and reads the same on every machine
  expect.soft(requirementNames(spec)).toEqual(['Zebra', 'apple'])

  // Requirement: Reading a file yields its requirements and what they record
  // Scenario: Entries come back in title order, not the file's order
  // THEN a requirement's entries come back in title order, for the same reason
  expect.soft(entriesOf(spec, 'Zebra')).toEqual([
    { scenario: 'Zebra is recorded first', file: 'tests/spec-file/read.test.ts' },
    { scenario: 'apple is recorded second', file: 'tests/spec-file/write.test.ts' },
  ])
})

// Requirement: Reading a file yields its requirements and what they record
// Scenario: A line inside a generated block that is not an entry records no scenario
// GIVEN a generated block holding one entry and three lines that are not entries: prose,
//       a bullet that is not quoted, and a quoted title with no file after the arrow
// WHEN the file is read
// THEN only the entry comes back, so a block someone has mangled records the one scenario
//      it still states and the guard reports the rest as unproven rather than inventing them
it('reads no scenario from a line inside a block that is not an entry', () => {
  const source = `### Requirement: Records where a scenario is

Its description.

<!-- scenarios: generated -->
- "A real entry" → tests/spec-file/read.test.ts
a line of prose that wandered in
- an unquoted bullet → tests/spec-file/read.test.ts
- "A title with no file" →
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  expect(onlyRequirement(spec).scenarios).toEqual([
    { scenario: 'A real entry', file: 'tests/spec-file/read.test.ts' },
  ])
})
