// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlyError, onlySite } from './support.ts'

// Requirement: A capability tag governs the file it heads
// Scenario: Every proof site in the file carries the file's capability
// GIVEN a file that declares a capability at the top and holds two tagged tests
// WHEN the file is scanned
// THEN both proof sites report that capability, which is written once for the file
//      rather than repeated on every test
it('attaches the file capability to every proof site', () => {
  const source = `// Capability: guard

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})

// Requirement: Every declared requirement has something proving it
// Scenario: A requirement with no scenario fails the build
// THEN the guard fails
it('fails on an uncovered requirement', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.capability).toBe('guard')
  expect(scan.sites.map(site => site.capability)).toEqual(['guard', 'guard'])
})

// Requirement: A capability tag governs the file it heads
// Scenario: A second capability tag is reported as an error
// GIVEN a file declaring two capabilities
// WHEN the file is scanned
// THEN the scan reports an error naming the line of the second tag, because a proof
//      site with two possible parents has no place in the tree
it('rejects a file that declares two capabilities', () => {
  const source = `// Capability: guard
// Capability: locate

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  const error = onlyError(scan)
  expect(error.kind).toBe('second-capability')
  expect(error.line).toBe(lineOf(source, '// Capability: locate'))
})

// Requirement: A capability tag governs the file it heads
// Scenario: A proof site in a file with no capability tag is unresolved
// GIVEN a tagged test in a file that declares no capability
// WHEN the file is scanned
// THEN the proof site is reported with its capability unresolved rather than as an
//      error, because the scan says what it found and guard decides what fails
it('reports a proof site with no capability as unresolved', () => {
  const source = `// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.capability).toBeUndefined()
  expect(onlySite(scan).capability).toBeUndefined()
  expect(scan.errors).toEqual([])
})

// Requirement: A capability tag governs the file it heads
// Scenario: A capability tag sharing a code line is not read
// GIVEN a `// Capability:` note trailing a line of code, not on its own line
// WHEN the file is scanned
// THEN it is not read as the file's capability, the same own-line rule the steps follow,
//      so the proof site is left unresolved
it('ignores a capability tag that shares a code line', () => {
  const source = `const config = load() // Capability: guard

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// THEN the guard fails
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  expect(scan.capability).toBeUndefined()
  expect(onlySite(scan).capability).toBeUndefined()
})
