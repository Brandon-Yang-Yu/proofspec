// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlySite } from './support.ts'

// Requirement: Every PROOF_SITE reports its current position
// Scenario: A PROOF_SITE reports the line of the code it tags
// GIVEN a tagged test partway down a file
// WHEN the file is scanned
// THEN the PROOF_SITE reports the line the test sits on, which is what locate answers
//      with and what guard points at
it('reports the line a proof site sits on', () => {
  const source = `import { guard } from '../src/guard/index.ts'

describe('the guard', () => {
  // Requirement: The guard fails the build on drift
  // Scenario: A stale capability file fails the build
  // THEN the guard fails
  it('fails on a stale capability file', () => {
    expect(guard(tree)).toBe('fail')
  })
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).line).toBe(lineOf(source, "it('fails on a stale capability file'"))
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: Each step reports its own line
// GIVEN a test with three steps above it
// WHEN the file is scanned
// THEN each step reports the line its keyword sits on, so a diagnostic can point at the
//      step it is about rather than at the test as a whole
it('reports the line of each step', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// GIVEN a committed capability file
// WHEN the tree is regenerated
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).steps.map(step => step.line)).toEqual([
    lineOf(source, '// GIVEN a committed capability file'),
    lineOf(source, '// WHEN the tree is regenerated'),
    lineOf(source, '// THEN the guard fails'),
  ])
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: Positions are right in a file containing non-ASCII text
// GIVEN a tagged test under a line of text outside ASCII
// WHEN the file is scanned
// THEN the reported lines are the lines as a reader counts them, because a spec written
//      in any language is still a spec
it.each([
  { language: 'Chinese', preamble: '// 守卫在提交的文件过期时让构建失败\nconst 守卫 = guard' },
  { language: 'Russian', preamble: '// Страж заваливает сборку, когда файл устарел\nconst страж = guard' },
])('reports the right lines in a file written in $language', ({ preamble }) => {
  const source = `${preamble}

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  const site = onlySite(scan)
  expect(site.line).toBe(lineOf(source, "it('fails on a stale capability file'"))
  expect(site.steps.map(step => step.line)).toEqual([
    lineOf(source, '// THEN the guard fails'),
  ])
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: A PROOF_SITE reports the line its tag block opens on
// GIVEN a test whose tag and Gherkin sit in a comment block above it
// WHEN the file is scanned
// THEN the site reports the line that block opens on, which is where the site starts for a
//      reader: the CLAIM is written above the code, so a change to it is a change to the site
it('reports the line a proof site opens on, tag block included', () => {
  const source = `import { guard } from '../src/guard/index.ts'

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).tagLine).toBe(lineOf(source, '// Requirement: The guard fails'))
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: A block site reports the line its test opens on
// GIVEN a test whose body tags two statements, under a GIVEN the two of them share
// WHEN the file is scanned
// THEN each block reports the line its test opens on, which is the only line telling a
//      reader where the prelude the blocks share ends and each block's own CLAIM begins
it('reports the line the test opens on for a site tagged inside the body', () => {
  const source = `// GIVEN a document with one version
it('posting a turn', async () => {
  const res = await post('/turn')

  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream
  expect.soft(res.status).toBe(200)

  // Requirement: A successful turn appends a version
  // Scenario: A successful turn appends one version
  // THEN exactly one new version is appended
  expect.soft(await listVersions(docId)).toHaveLength(2)
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.sites.map(site => site.testLine)).toEqual([
    lineOf(source, "it('posting a turn'"),
    lineOf(source, "it('posting a turn'"),
  ])
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: A block site opens where its own tag block does, below the steps it shares
// GIVEN a test whose body tags a statement, under a GIVEN the whole test shares
// WHEN the file is scanned
// THEN the block opens on its own `// Requirement:` line rather than on the shared step above
//      the test, because the shared prelude is where every block starts and none of them opens
it('reports the line a block opens on, below the prelude it shares', () => {
  const source = `// GIVEN a document with one version
it('posting a turn', async () => {
  const res = await post('/turn')

  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream
  expect.soft(res.status).toBe(200)
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).tagLine).toBe(lineOf(source, '// Requirement: A turn streams the reply'))
})

// Requirement: Every PROOF_SITE reports its current position
// Scenario: A block site reports the lines of the steps its test shares
// GIVEN a test whose body tags a statement, under a GIVEN and a WHEN the whole test shares
// WHEN the file is scanned
// THEN the shared steps report the lines they are written on, which is what tells a block
//      which of its steps came from above its test and where its shared CLAIM opens
it('reports the line of each step a block shares with its test', () => {
  const source = `// GIVEN a document with one version
// WHEN a turn is posted
it('posting a turn', async () => {
  const res = await post('/turn')

  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream
  expect.soft(res.status).toBe(200)
})
`

  const scan = scanSource(source, { file: FILE })

  expect(onlySite(scan).steps.map(step => step.line)).toEqual([
    lineOf(source, '// GIVEN a document with one version'),
    lineOf(source, '// WHEN a turn is posted'),
    lineOf(source, '// THEN the response is an SSE stream'),
  ])
})
