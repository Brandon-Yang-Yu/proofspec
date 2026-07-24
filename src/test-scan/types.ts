/**
 * What a scan of one test file yields. This is the whole contract between `test-scan`
 * and everything downstream: nothing past this file learns that TypeScript exists.
 */

export type StepKeyword = 'GIVEN' | 'WHEN' | 'THEN'

export type Step = {
  readonly keyword: StepKeyword
  /** The step's text, with continuation lines joined by a single space. */
  readonly text: string
  /** 1-based line of the comment carrying the keyword. */
  readonly line: number
}

export type ProofSite = {
  /** The file's `// Capability:` tag. `undefined` when the file declares none. */
  readonly capability: string | undefined
  readonly requirement: string
  readonly scenario: string
  /** The steps above the site. A block also carries the GIVEN/WHEN above its test. */
  readonly steps: readonly Step[]
  readonly file: string
  /** 1-based line of the tagged code: the test, or the statement that opens the block. */
  readonly line: number
  /** 1-based last line of the site: the end of the test, or of the block. */
  readonly endLine: number
}

export type ScanErrorKind =
  /** An AND where a step keyword belongs. */
  | 'and-step'
  /** One test tags both above itself and inside its body, so its sites count two ways. */
  | 'mixed-placement'
  /** A file declares more than one capability, so its sites have two possible parents. */
  | 'second-capability'

/**
 * Something the scan could not read. The scan only reports it; `guard` decides whether a
 * build can proceed.
 */
export type ScanError = {
  readonly kind: ScanErrorKind
  readonly file: string
  readonly line: number
  readonly message: string
}

export type FileScan = {
  readonly file: string
  readonly capability: string | undefined
  /** In source order: by opening line, and for blocks by their order inside the test. */
  readonly sites: readonly ProofSite[]
  readonly errors: readonly ScanError[]
}
