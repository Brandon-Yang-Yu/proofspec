/**
 * The file the collector writes and `impact` reads: one JSON object per line, one line per
 * test. JSON Lines because vitest runs test files in separate workers, and appending a line
 * is the only write several processes can make to one file without coordinating.
 */

/** Where the collector writes unless `PROOFSPEC_COVERAGE` names somewhere else. */
export const DEFAULT_COVERAGE_FILE = '.proofspec-coverage.jsonl'

/** One line of that file: what one test ran. */
export type TestRunLine = {
  /** The test file, relative to the repo root. */
  readonly file: string
  /** The line the test opens on: the same line the proof site carries. */
  readonly line: number
  readonly ran: readonly { readonly file: string; readonly names: readonly string[] }[]
}
