import type { ProofSite, Step } from '../../src/test-scan/index.ts'

/** The file a fixture site is proven in, unless a test varies it to make its point. */
export const FILE = 'tests/example.test.ts'

/**
 * A `ProofSite` for locate to read, with a default for every field a given test does not
 * care about. The default capability is a real one, so a plain `site({ scenario })` is a
 * scenario locate can place.
 */
export function site(fields: {
  readonly scenario: string
  readonly capability?: string | undefined
  readonly requirement?: string
  readonly file?: string
  readonly line?: number
  readonly endLine?: number
  readonly steps?: readonly Step[]
}): ProofSite {
  const line = fields.line ?? 1
  return {
    capability: fields.capability ?? 'locate',
    requirement: fields.requirement ?? 'A requirement',
    scenario: fields.scenario,
    steps: fields.steps ?? [],
    file: fields.file ?? FILE,
    line,
    endLine: fields.endLine ?? line,
  }
}
