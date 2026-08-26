// Capability: spec-file

import { expect, it } from 'vitest'
import { readCapabilityFile, updateScenarioBlocks } from '../../src/spec-file/index.ts'

const CAPABILITY = 'spec-file'
const REQUIREMENT = 'A demonstrated promise'
const FILE = 'tests/demo.test.ts'

/**
 * A capability file holding a vocabulary, the way one is written: the terms first, then the
 * requirements that use them. Each Term section ends at the next heading.
 */
const WITH_TERMS = `# spec-file

Opening prose about the capability.

### Term: TURN

One exchange of request and reply.

### Term: REPLY

The answer half of a TURN.

### Requirement: A demonstrated promise

The tool SHALL answer every TURN.

<!-- scenarios: generated -->
- "A demonstrated behavior" → ${FILE}
<!-- /scenarios -->
`

// Requirement: Reading a file yields its terms and what they define
// Scenario: A Term heading reads as a term with the definition written under it
// GIVEN a capability file holding two Term sections, each with a definition and each ended
//       by the heading that follows it
// WHEN the file is read
// THEN both terms come back in the order the file declares them, each with the definition
//      written beneath its heading
it('reads each Term heading with the definition written under it', () => {
  const spec = readCapabilityFile(WITH_TERMS, { capability: CAPABILITY })

  expect(spec.terms).toEqual([
    { term: 'TURN', definition: 'One exchange of request and reply.' },
    { term: 'REPLY', definition: 'The answer half of a TURN.' },
  ])
})

// Requirement: Reading a file yields its terms and what they define
// Scenario: A Term section is not part of a requirement's description
// GIVEN a requirement whose description is followed by a Term section and then the
//       requirement's generated block
// WHEN the file is read
// THEN the description is the prose the person wrote and nothing of the term's, the term's
//      definition is the prose under its heading and nothing of the block's, and the
//      entries the block records still come back — because a heading and a block both end
//      prose, and neither one's content belongs to the other
it('reads a description and a definition that stop where the other begins', () => {
  const source = `# spec-file

### Requirement: ${REQUIREMENT}

The tool SHALL answer every TURN.

### Term: REPLY

The answer half of a TURN.

<!-- scenarios: generated -->
- "A demonstrated behavior" → ${FILE}
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })
  const requirement = spec.requirements[0]!

  expect(requirement.description).toBe('The tool SHALL answer every TURN.')
  expect(spec.terms).toEqual([{ term: 'REPLY', definition: 'The answer half of a TURN.' }])
  expect(requirement.scenarios).toEqual([{ scenario: 'A demonstrated behavior', file: FILE }])
})

// Requirement: Reading a file yields its terms and what they define
// Scenario: A Term heading inside a fenced code block is not a term
// GIVEN a capability file showing what a Term section looks like inside a fenced code block
// WHEN the file is read
// THEN the file declares no terms, because the fence is the file saying what the format
//      looks like, not using it
it('does not read a Term heading inside a fenced code block', () => {
  const source = `# spec-file

\`\`\`markdown
### Term: TURN

One exchange of request and reply.
\`\`\`

### Requirement: ${REQUIREMENT}

The tool SHALL answer every turn.

<!-- scenarios: generated -->
- "A demonstrated behavior" → ${FILE}
<!-- /scenarios -->
`

  const spec = readCapabilityFile(source, { capability: CAPABILITY })

  expect(spec.terms).toEqual([])
})

// Requirement: Reading a file yields its terms and what they define
// Scenario: Writing back leaves Term sections exactly as they were
// GIVEN a capability file holding Term sections and a requirement whose block already
//       records what the tests prove
// WHEN the write-back runs with those same entries
// THEN the file comes back byte for byte unchanged, Term sections included, because a
//      definition is the human's half of the file and the write-back touches only the
//      blocks it owns
it('leaves Term sections exactly as they were when writing back', () => {
  const written = updateScenarioBlocks(WITH_TERMS, {
    requirements: [
      { requirement: REQUIREMENT, scenarios: [{ scenario: 'A demonstrated behavior', file: FILE }] },
    ],
  })

  expect(written).toBe(WITH_TERMS)
})
