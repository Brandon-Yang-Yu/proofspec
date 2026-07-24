import type { ProofSite, Step } from '../../src/test-scan/index.ts'

/** The file a fixture site is proven in, unless a test varies it to make its point. */
export const FILE = 'tests/example.test.ts'

/**
 * A `ProofSite` for the tree to place, with a default for every field a given test does
 * not care about. Pass `capability: undefined` explicitly to model a site the scan could
 * not resolve — the default is a real capability, so a plain `site({ scenario })` is
 * placeable.
 */
export function site(fields: {
  readonly scenario: string
  readonly capability?: string | undefined
  readonly requirement?: string
  readonly file?: string
  readonly line?: number
  readonly steps?: readonly Step[]
}): ProofSite {
  const line = fields.line ?? 1
  return {
    capability: 'capability' in fields ? fields.capability : 'spec-tree',
    requirement: fields.requirement ?? 'A requirement',
    scenario: fields.scenario,
    steps: fields.steps ?? [],
    file: fields.file ?? FILE,
    line,
    endLine: line,
  }
}
