import { assertNever } from '../assert-never.ts'
import { describeFinding, severityOf, type Finding } from '../guard/index.ts'
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

// The single-character severity tags a quickfix list expects: E for a finding that fails the
// build, W for one that only warns. An editor reads the tag to colour the entry.
const QUICKFIX_ERROR = 'E'
const QUICKFIX_WARNING = 'W'
// LSP DiagnosticSeverity values travel as numbers on the wire: 1 = Error, 2 = Warning.
const LSP_ERROR = 1
const LSP_WARNING = 2

/**
 * Each finding as one `file:line:E: message` line — the shape vim/nvim loads into its
 * quickfix list via `errorformat`. The content is the text form's; only the line shape
 * changes, so an editor can jump straight to each site. Non-checked outcomes have no
 * findings, so they fall back to the text form a person reads.
 */
export function renderQuickfix(outcome: Outcome): string {
  if (outcome.kind !== 'checked') {
    return renderText(outcome)
  }
  return outcome.report.findings.map(renderQuickfixFinding).join('\n')
}

function renderQuickfixFinding(finding: Finding): string {
  const message = describeFinding(finding)
  // A finding with no file (an uncovered or duplicate requirement) has nowhere to jump to;
  // plain text beats a malformed `:line:` entry an editor would misparse.
  if (!('file' in finding)) return message
  const severity = severityOf(finding) === 'fail' ? QUICKFIX_ERROR : QUICKFIX_WARNING
  const line = 'line' in finding ? finding.line : 1
  return `${finding.file}:${line}:${severity}: ${message}`
}

/**
 * Each finding as one LSP Diagnostic, so an editor's diagnostics UI shows the same findings
 * inline that a person reads in the terminal. The content is the JSON report's, reshaped
 * into the {severity, range, message, code} a diagnostic carries. Non-checked outcomes fall
 * back to the JSON form, since a diagnostics consumer is already parsing JSON.
 */
export function renderDiagnostics(outcome: Outcome): string {
  if (outcome.kind !== 'checked') {
    return renderJson(outcome)
  }

  const diagnostics = outcome.report.findings.map(finding => {
    // A finding without a line (an uncovered or duplicate requirement) has no site; pin it at
    // line 0 of nothing rather than inventing a position, the way a diagnostic with no range.
    const line = 'line' in finding ? Math.max(0, finding.line - 1) : 0
    return {
      severity: severityOf(finding) === 'fail' ? LSP_ERROR : LSP_WARNING,
      range: { start: { line, character: 0 }, end: { line, character: 0 } },
      message: describeFinding(finding),
      source: 'proofspec',
      code: finding.kind,
    }
  })

  return JSON.stringify({ diagnostics })
}
