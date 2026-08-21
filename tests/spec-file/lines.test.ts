// Capability: spec-file

import { expect, it } from 'vitest'
import { requirementLines } from '../../src/spec-file/index.ts'
import { FENCE } from './support.ts'

// Requirement: Where each requirement is written is delivered on demand
// Scenario: A requirement's heading line is reported as it stands
// GIVEN a capability file with two requirements
// WHEN the lines its requirements are written on are asked for
// THEN each requirement comes back with the 1-based line of its heading, so a reader can be
//      sent straight to the promise
it('reports the line each requirement heading is written on', () => {
  const source = [
    '# demo',
    '',
    '### Requirement: A first promise',
    'The tool SHALL do the first thing.',
    '',
    '### Requirement: A second promise',
    'The tool SHALL do the second thing.',
    '',
  ].join('\n')

  const lines = requirementLines(source)

  expect(lines.get('A first promise')).toBe(3)
  expect(lines.get('A second promise')).toBe(6)
})

// Requirement: Where each requirement is written is delivered on demand
// Scenario: A heading shown inside a code fence is not a place a requirement is written
// GIVEN a capability file whose description shows a requirement heading as an example in a fence
// WHEN the lines its requirements are written on are asked for
// THEN only the real heading is reported, the same fence rule reading follows, so a file
//      documenting the format does not gain a requirement by showing one
it('does not report a requirement heading shown inside a code fence', () => {
  const source = [
    '# demo',
    '',
    '### Requirement: A real promise',
    'The format looks like this:',
    '',
    FENCE,
    '### Requirement: An example, not a promise',
    FENCE,
    '',
  ].join('\n')

  const lines = requirementLines(source)

  expect([...lines.keys()]).toEqual(['A real promise'])
})
