import { assertNever } from '../assert-never.ts'
import { describeFinding } from '../guard/index.ts'
import type { Outcome } from './types.ts'

/**
 * Turns an `Outcome` into the three things the process boundary needs: an exit code, a line
 * for a person, and a line for a program. This is where a verdict becomes a number — the
 * boundary `guard` deliberately stopped short of (design.md §18).
 */

const EXIT_OK = 0
const EXIT_DRIFT = 1
const EXIT_CANNOT_RUN = 2

/**
 * The exit code a build acts on. Drift and cannot-run are different non-zero codes so CI
 * can tell "your spec is wrong" from "I could not run", which is the whole point of R2.
 */
export function exitCodeOf(outcome: Outcome): 0 | 1 | 2 {
  switch (outcome.kind) {
    case 'checked':
      return outcome.report.status === 'fail' ? EXIT_DRIFT : EXIT_OK
    case 'wrote':
      return EXIT_OK
    case 'cannot-run':
      return EXIT_CANNOT_RUN
    default:
      return assertNever(outcome)
  }
}

/** The answer written for a person to read in a terminal. */
export function renderText(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'checked':
      return outcome.report.findings.length === 0
        ? 'pass'
        : outcome.report.findings.map(describeFinding).join('\n')
    case 'wrote':
      return outcome.files.length === 0
        ? 'nothing to write'
        : [`wrote ${outcome.files.length} file(s):`, ...outcome.files.map(file => `  ${file}`)].join('\n')
    case 'cannot-run':
      return outcome.reason
    default:
      return assertNever(outcome)
  }
}

/**
 * The same answer as JSON, for the editor, the CI annotation, and the later MCP server that
 * should read the answer rather than parse the terminal form. A checked outcome gives back
 * the whole report, so the findings a person reads and a program reads are the same content.
 */
export function renderJson(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'checked':
      return JSON.stringify(outcome.report)
    case 'wrote':
      return JSON.stringify({ changed: outcome.files })
    case 'cannot-run':
      return JSON.stringify({ error: outcome.reason })
    default:
      return assertNever(outcome)
  }
}
