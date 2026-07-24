// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlySite } from './support.ts'

// Requirement: Every proof site reports its current position
// Scenario: A proof site reports the line of the code it tags
// GIVEN a tagged test partway down a file
// WHEN the file is scanned
// THEN the proof site reports the line the test sits on, which is what locate answers
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

// Requirement: Every proof site reports its current position
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

// Requirement: Every proof site reports its current position
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
