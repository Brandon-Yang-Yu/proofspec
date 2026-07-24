// Capability: test-scan

import { expect, it } from 'vitest'
import { scanSource } from '../../src/test-scan/index.ts'
import { FILE, lineOf, onlySite, stepsOf } from './support.ts'

// Requirement: A file's proof sites depend on nothing but that file
// Scenario: A file that does not compile still yields its proof sites
// GIVEN a tagged test in a file that would not survive a type check
// WHEN the file is scanned
// THEN its proof site is reported in full, because the spec matters most in the middle
//      of a refactor, which is exactly when the build is least likely to be green
it.each([
  { flaw: 'a type error', code: `const attempts: number = 'not a number'` },
  { flaw: 'an import of a module that does not exist', code: `import { guard } from './nowhere.ts'` },
])('scans a file holding $flaw', ({ code }) => {
  const source = `${code}

// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// WHEN the tree regenerated from the tests differs from the committed file
// THEN the guard fails and reports the difference
it('fails on a stale capability file', () => {
  expect(guard(tree)).toBe('fail')
})
`

  const scan = scanSource(source, { file: FILE })

  const site = onlySite(scan)
  expect(site.requirement).toBe('The guard fails the build on drift')
  expect(site.scenario).toBe('A stale capability file fails the build')
  expect(site.line).toBe(lineOf(source, "it('fails on a stale capability file'"))
  expect(stepsOf(site)).toEqual([
    {
      keyword: 'WHEN',
      text: 'the tree regenerated from the tests differs from the committed file',
    },
    { keyword: 'THEN', text: 'the guard fails and reports the difference' },
  ])
})
