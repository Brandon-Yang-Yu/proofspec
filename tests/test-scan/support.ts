import type { FileScan, ProofSite, ScanError } from '../../src/test-scan/index.ts'

/** Every fixture is scanned under one name; no assertion depends on which. */
export const FILE = 'tests/example.test.ts'

/**
 * The 1-based line of the first line of `source` containing `needle`.
 *
 * Assertions name the line they expect this way rather than counting it out, so editing a
 * fixture cannot silently move what a test claims. Missing text throws, because an
 * expectation of line 0 would pass for the wrong reason.
 */
export function lineOf(source: string, needle: string): number {
  const lines = source.split('\n')
  const index = lines.findIndex(line => line.includes(needle))
  if (index === -1) {
    throw new Error(`the fixture has no line containing ${JSON.stringify(needle)}`)
  }
  return index + 1
}

export function onlySite(scan: FileScan): ProofSite {
  const [site, ...rest] = scan.sites
  if (site === undefined || rest.length > 0) {
    throw new Error(`expected exactly one proof site, got ${scan.sites.length}`)
  }
  return site
}

export function onlyError(scan: FileScan): ScanError {
  const [error, ...rest] = scan.errors
  if (error === undefined || rest.length > 0) {
    throw new Error(`expected exactly one error, got ${scan.errors.length}`)
  }
  return error
}

/** A step compared without its line, for the tests whose claim is not about position. */
export function stepsOf(site: ProofSite): { keyword: string; text: string }[] {
  return site.steps.map(step => ({ keyword: step.keyword, text: step.text }))
}
