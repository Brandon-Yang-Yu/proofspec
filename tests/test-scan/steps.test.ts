// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlyError, onlySite, stepsOf } from './support.ts'

// Requirement: Gherkin steps are read exactly as written
// Scenario: The steps above a test are read in order
// GIVEN a test with a GIVEN, a WHEN and a THEN on the lines above it
// WHEN the file is scanned
// THEN its proof site carries the three steps in the order written, each with its
//      keyword and its text taken as written
it('reads the steps above a test', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// GIVEN a committed capability file
// WHEN the tree regenerated from the tests differs from it
// THEN the guard fails and reports the difference
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(stepsOf(onlySite(scan))).toEqual([
    { keyword: 'GIVEN', text: 'a committed capability file' },
    { keyword: 'WHEN', text: 'the tree regenerated from the tests differs from it' },
    { keyword: 'THEN', text: 'the guard fails and reports the difference' },
  ])
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: A comment line with no keyword continues the step above it
// GIVEN a THEN whose text runs onto two further comment lines
// WHEN the file is scanned
// THEN the three lines are read as one step, so a step can run to a second sentence
//      without an AND
it('joins a continuation line onto the step above it', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails and reports the difference, naming both the
//      requirement and the scenario that moved.
//      The build stops there.
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(stepsOf(onlySite(scan))).toEqual([
    {
      keyword: 'THEN',
      text:
        'the guard fails and reports the difference, naming both the requirement and ' +
        'the scenario that moved. The build stops there.',
    },
  ])
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: AND is reported as an error
// GIVEN an AND where a step keyword belongs, whether above a test or inside a block
// WHEN the file is scanned
// THEN the scan reports one and-step error naming the AND's line, because a second
//      outcome under one THEN is a second scenario, wherever the AND sits
it.each([
  {
    where: 'above a test',
    source: `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
// AND it names the file that went stale
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`,
  },
  {
    where: 'inside a block',
    source: `it('posting a turn', async () => {
  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream
  // AND the status is 200
  expect.soft(res.status).toBe(200)
})
`,
  },
])('rejects an AND $where', ({ source }) => {
  const scan = scanSource(source, { file: FILE })

  const error = onlyError(scan)
  expect(error.kind).toBe('and-step')
  expect(error.line).toBe(lineOf(source, '// AND'))
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: A block comment is not read as a step
// GIVEN steps written in a `/* */` comment above a tagged test
// WHEN the file is scanned
// THEN the proof site carries no steps, because only `//` comments are read
it('ignores steps written in a block comment', () => {
  const source = `/* WHEN the tree is regenerated
   THEN the guard fails */
// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).steps).toEqual([])
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: A comment separated by a blank line is not read as a step
// GIVEN a comment about something else, a blank line, then a tagged test with one step
// WHEN the file is scanned
// THEN only the step below the blank line is read, so a comment about something else
//      never becomes a claim about a test
it('ignores a comment cut off from the test by a blank line', () => {
  const source = `// THEN this note is about the file, not about the test below it

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// WHEN the tree is regenerated
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(stepsOf(onlySite(scan))).toEqual([
    { keyword: 'WHEN', text: 'the tree is regenerated' },
  ])
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: A shared GIVEN and WHEN are delivered on every block in the test
// GIVEN a test with a GIVEN and a WHEN above it and two tagged blocks inside it
// WHEN the file is scanned
// THEN every block carries the shared GIVEN and WHEN ahead of its own THEN, so the
//      author writes the action once and each site still reads as a whole claim
it('delivers the shared steps on each block', () => {
  const source = `// GIVEN a document with one version
// WHEN a turn is posted
it('posting a turn', async () => {
  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream
  expect.soft(res.headers['content-type']).toBe('text/event-stream')

  // Requirement: A successful turn appends a version
  // Scenario: A successful turn appends one version
  // THEN exactly one new version is appended
  expect.soft(versions).toHaveLength(2)
})
`

  const scan = scanSource(source, { file: FILE })
  const [firstBlock, secondBlock] = scan.sites
  if (firstBlock === undefined || secondBlock === undefined) {
    throw new Error(`expected two proof sites, got ${scan.sites.length}`)
  }

  expect(stepsOf(firstBlock)).toEqual([
    { keyword: 'GIVEN', text: 'a document with one version' },
    { keyword: 'WHEN', text: 'a turn is posted' },
    { keyword: 'THEN', text: 'the response is an SSE stream' },
  ])
  expect(stepsOf(secondBlock)).toEqual([
    { keyword: 'GIVEN', text: 'a document with one version' },
    { keyword: 'WHEN', text: 'a turn is posted' },
    { keyword: 'THEN', text: 'exactly one new version is appended' },
  ])
})

// Requirement: Gherkin steps are read exactly as written
// Scenario: A comment sharing a code line is not read as a step
// GIVEN a `//` comment that shares a line with code, sitting above a tagged test
// WHEN the file is scanned
// THEN it is not read as a step, because only a comment that owns its line leads the
//      test, so a note trailing a line of code never becomes a claim
it('ignores a comment that shares a code line', () => {
  const source = `const setup = prepare() // GIVEN a stale committed file
// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// WHEN the tree is regenerated
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(stepsOf(onlySite(scan))).toEqual([
    { keyword: 'WHEN', text: 'the tree is regenerated' },
  ])
})
