// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlyError, onlySite } from './support.ts'

// Requirement: A tag pair's layer decides the proof site
// Scenario: A tag pair above a test makes the whole test one proof site
// GIVEN a test with a Requirement and a Scenario tag on the lines directly above it
// WHEN the file is scanned
// THEN one proof site is reported, carrying both tag names and running from the first
//      line of the test to its last
it('reads a tag pair above a test as one proof site', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// WHEN the tree regenerated from the tests differs from the committed file
// THEN the guard fails and reports the difference
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.sites).toHaveLength(1)
  const site = onlySite(scan)
  expect(site.requirement).toBe('The guard fails the build on drift')
  expect(site.scenario).toBe('A stale capability file fails the build')
  expect(site.file).toBe(FILE)
  expect(site.line).toBe(lineOf(source, "it('fails on a stale capability file'"))
  expect(site.endLine).toBe(lineOf(source, '})'))
})

// GIVEN a test whose body carries two tagged statements, with an untagged statement
//       under the second one
// WHEN the file is scanned
it('reads the tagged statements inside a test', () => {
  const source = `// GIVEN a document with one version
// WHEN a turn is posted
it('posting a turn', async () => {
  const res = await post('/turn')

  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream carrying the assistant tokens
  expect.soft(res.headers['content-type']).toBe('text/event-stream')

  // Requirement: A successful turn appends a version
  // Scenario: A successful turn appends one version
  // THEN exactly one new version is appended to the document
  const versions = await listVersions(docId)
  expect.soft(versions).toHaveLength(2)
})
`

  const scan = scanSource(source, { file: FILE })
  const [firstBlock, secondBlock] = scan.sites
  if (firstBlock === undefined || secondBlock === undefined) {
    throw new Error(`expected two proof sites, got ${scan.sites.length}`)
  }

  // Requirement: A tag pair's layer decides the proof site
  // Scenario: Each tagged statement inside a test opens its own proof site
  // THEN one proof site is reported for each tagged statement, and none for the test
  //      itself, which carries no tag pair of its own
  expect.soft(scan.sites.map(site => site.scenario)).toEqual([
    'The reply is streamed as SSE',
    'A successful turn appends one version',
  ])

  // Requirement: A tag pair's layer decides the proof site
  // Scenario: A block ends at the statement before the next tagged one
  // THEN the first block ends on its own statement, because the next one is tagged, and
  //      the second runs on through the untagged statement below it to the end of the
  //      test
  expect.soft(firstBlock.line).toBe(lineOf(source, "expect.soft(res.headers"))
  expect.soft(firstBlock.endLine).toBe(lineOf(source, "expect.soft(res.headers"))
  expect.soft(secondBlock.line).toBe(lineOf(source, 'const versions = await listVersions'))
  expect.soft(secondBlock.endLine).toBe(lineOf(source, 'expect.soft(versions)'))
})

// Requirement: A tag pair's layer decides the proof site
// Scenario: A test tagged both above and inside is reported as an error
// GIVEN a test carrying a tag pair above it and another on a statement inside it
// WHEN the file is scanned
// THEN the scan reports a mixed-placement error naming the line of the test, whose proof
//      sites could otherwise be counted two ways
it('rejects a test that uses both tag placements', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: Tagged above the test
// THEN the guard fails
it('tagged twice over', () => {
  // Requirement: The guard fails the build on drift
  // Scenario: Tagged inside the test
  // THEN the guard says why
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  const error = onlyError(scan)
  expect(error.kind).toBe('mixed-placement')
  expect(error.line).toBe(lineOf(source, "it('tagged twice over'"))
})

// Requirement: A tag pair's layer decides the proof site
// Scenario: A test nested in describe blocks is found however deep it sits
// GIVEN a tagged test two describe blocks deep
// WHEN the file is scanned
// THEN its proof site is reported, the same as one written at the top level
it('finds a test nested in describe blocks', () => {
  const source = `describe('the guard', () => {
  describe('when the committed file is stale', () => {
    // Requirement: The guard fails the build on drift
    // Scenario: A stale capability file fails the build
    // THEN the guard fails
    it('fails', () => {
      expect(guard(tree)).toBe('fail')
    })
  })
})
`

  const scan = scanSource(source, { file: FILE })

  const site = onlySite(scan)
  expect(site.scenario).toBe('A stale capability file fails the build')
  expect(site.line).toBe(lineOf(source, "it('fails'"))
})

// Requirement: A tag pair's layer decides the proof site
// Scenario: A parameterised test is one proof site however many rows it has
// GIVEN a tagged parameterised test with three rows
// WHEN the file is scanned
// THEN one proof site is reported, not one per row, because rows that differ only in
//      data are one scenario
it('counts a parameterised test once', () => {
  const source = `// Requirement: A proof site the tree cannot hold fails the build
// Scenario: A site in a file with no capability fails the build
// THEN the guard fails, naming the site it could not place
it.each([
  { site: 'a whole test' },
  { site: 'a block inside a test' },
  { site: 'a parameterised test' },
])('fails on $site with no capability', ({ site }) => {
  expect(guard(site)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.sites).toHaveLength(1)
  expect(onlySite(scan).line).toBe(lineOf(source, 'it.each(['))
})

// Requirement: A tag pair's layer decides the proof site
// Scenario: Text that only looks like a test is not a test
// GIVEN a file holding one real tagged test and, below it, an `it(...)` written where it
//       cannot run
// WHEN the file is scanned
// THEN only the real test is reported, because a proof site is a place that runs
it.each([
  { where: 'a string literal', decoy: `const sample = "it('not a test', () => {})"` },
  { where: 'a comment', decoy: `// it('not a test', () => {})` },
])('ignores an it( written in $where', ({ decoy }) => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('the real test', () => {
  expect(guard(tree)).toBe('fail')
})

${decoy}
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.sites).toHaveLength(1)
  expect(onlySite(scan).line).toBe(lineOf(source, "it('the real test'"))
})

// Requirement: A tag pair's layer decides the proof site
// Scenario: A test declared with any alias or modifier is found
// GIVEN a tagged test declared with one of the names and modifiers a runner accepts
// WHEN the file is scanned
// THEN its proof site is reported, because which alias the author reached for says
//      nothing about what the test claims
it.each([
  { declaration: "it('runs', () => {" },
  { declaration: "test('runs', () => {" },
  { declaration: "it.skip('runs', () => {" },
  { declaration: "it.only('runs', () => {" },
  { declaration: "it.concurrent('runs', () => {" },
  { declaration: "test.skip('runs', () => {" },
])('finds a test declared as $declaration', ({ declaration }) => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
${declaration}
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  const site = onlySite(scan)
  expect(site.scenario).toBe('A stale capability file fails the build')
  expect(site.line).toBe(lineOf(source, declaration))
})
