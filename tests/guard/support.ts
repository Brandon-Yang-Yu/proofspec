import type { ScenarioNode, SpecTree } from '../../src/spec-tree/index.ts'
import type { FileScan, ProofSite, ScanError, ScanErrorKind, Step } from '../../src/test-scan/index.ts'

/** The capability a fixture site belongs to, unless a test varies it to make its point. */
export const CAPABILITY = 'guard'

/** The requirement a fixture site is tagged with, unless a test varies it. */
export const REQUIREMENT = 'A requirement'

/** The file a fixture site is proven in, unless a test varies it. */
export const FILE = 'tests/example.test.ts'

/**
 * The step a fixture site carries. Sites default to having one, because a site with none
 * is a finding of its own — only the test that makes that point should produce it.
 */
const A_STEP: Step = { keyword: 'THEN', text: 'the claim holds', line: 1 }

/**
 * A `ProofSite` for the guard to judge, with a default for every field a given test does
 * not care about. Pass `capability: undefined` explicitly to model a site the scan could
 * not place.
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
    capability: 'capability' in fields ? fields.capability : CAPABILITY,
    requirement: fields.requirement ?? REQUIREMENT,
    scenario: fields.scenario,
    steps: fields.steps ?? [A_STEP],
    file: fields.file ?? FILE,
    line,
    endLine: line,
  }
}

/** One file's scan. Its file and capability follow the sites it holds, as a real scan's do. */
export function scan(
  fields: {
    readonly sites?: readonly ProofSite[]
    readonly errors?: readonly ScanError[]
  } = {},
): FileScan {
  const sites = fields.sites ?? []
  return {
    file: sites[0]?.file ?? FILE,
    capability: sites[0]?.capability,
    sites,
    errors: fields.errors ?? [],
  }
}

export function scanError(fields: {
  readonly kind: ScanErrorKind
  readonly file?: string
  readonly line?: number
  readonly message?: string
}): ScanError {
  return {
    kind: fields.kind,
    file: fields.file ?? FILE,
    line: fields.line ?? 1,
    message: fields.message ?? 'the scan could not read this',
  }
}

/**
 * A committed tree, written the way the capability files read: capability, then
 * requirement, then the entries recorded for it. A requirement with no entries is one the
 * file declares and nothing proves yet.
 */
export function committed(capabilities: {
  readonly [capability: string]: { readonly [requirement: string]: readonly ScenarioNode[] }
}): SpecTree {
  return {
    capabilities: Object.entries(capabilities).map(([capability, requirements]) => ({
      capability,
      requirements: Object.entries(requirements).map(([requirement, scenarios]) => ({
        requirement,
        scenarios,
      })),
    })),
  }
}
