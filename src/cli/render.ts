import { assertNever } from '../assert-never.ts'
import { describeFinding, severityOf, type Finding } from '../guard/index.ts'
import type { ImpactNode } from '../impact/index.ts'
import type {
  GoneScenario,
  ImpactReport,
  Outcome,
  SpecLocation,
  TestProves,
  TouchedReport,
  TouchedScenarioReport,
  UnmatchedLines,
} from './types.ts'

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
    // A report, not a verdict: naming a promise this change touched — even one nothing proves
    // any more — is not the tool saying the build is wrong. That is the check's answer to give.
    case 'touched':
    case 'impact':
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
    case 'touched':
      return renderTouched(outcome.report)
    case 'impact':
      return renderImpact(outcome.report)
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
    case 'touched':
    case 'impact':
      return JSON.stringify(outcome.report)
    case 'cannot-run':
      return JSON.stringify({ error: outcome.reason })
    default:
      return assertNever(outcome)
  }
}

/**
 * What a change touched, as a person reads it. Each line a reader can act on starts with the
 * place to open — `file:line` — and the line under it names the promise and where it is
 * written, so the two questions a diff raises ("which claim is this?" and "where does it
 * live?") are answered without leaving the report.
 */
function renderTouched(report: TouchedReport): string {
  const nothing = report.scenarios.length === 0 && report.unmatched.length === 0 && report.gone.length === 0
  if (nothing) return `nothing touched since ${report.base}`

  const parts = [`touched since ${report.base}`]
  if (report.scenarios.length > 0) parts.push(report.scenarios.map(renderTouchedScenario).join('\n'))
  if (report.unmatched.length > 0) parts.push(report.unmatched.map(renderUnmatched).join('\n'))
  if (report.gone.length > 0) parts.push(['no longer proven:', ...report.gone.map(renderGone)].join('\n'))
  return parts.join('\n\n')
}

function renderTouchedScenario(scenario: TouchedScenarioReport): string {
  // The claim is the promise itself; saying so is the difference between "review this
  // sentence" and "review this test".
  const claim = scenario.claim === 'changed' ? '  [the claim changed]' : ''
  return [
    `${scenario.file}:${scenario.from}  ${scenario.scenario}${claim}`,
    `    ${scenario.capability} → ${scenario.requirement}${where(scenario.spec)}`,
  ].join('\n')
}

function renderUnmatched(lines: UnmatchedLines): string {
  const at = lines.from === lines.to ? `${lines.from}` : `${lines.from}-${lines.to}`
  return `${lines.file}:${at}  changed outside every proof`
}

function renderGone(scenario: GoneScenario): string {
  return [
    `${scenario.file}  ${scenario.scenario}`,
    `    ${scenario.capability} → ${scenario.requirement}${where(scenario.spec)}`,
  ].join('\n')
}

/** Where a requirement is written, or nothing when no capability file declares it. */
function where(spec: SpecLocation | undefined): string {
  return spec === undefined ? '' : `  → ${spec.file}:${spec.line}`
}

/**
 * What a change to the source reaches, as a tree a person reads top-down: the function that
 * changed, then what calls it, with the tests hanging off whichever function they call. The
 * promises come after the tree rather than inside it, because one test file can appear at
 * several places on the tree and its promises are the same wherever it hangs.
 */
function renderImpact(report: ImpactReport): string {
  if (report.changed.length === 0 && report.unmapped.length === 0) {
    return `nothing outside the tests changed since ${report.base}`
  }

  const parts = [`what this change reaches, since ${report.base}`]
  if (report.changed.length > 0) {
    parts.push(report.changed.flatMap(node => renderImpactNode(node, 0)).join('\n'))
  }
  if (report.unmapped.length > 0) {
    parts.push(['changed, but the graph knows no function here:', ...report.unmapped.map(file => `  ${file}`)].join('\n'))
  }
  if (report.proves.length > 0) {
    parts.push(['to review:', ...report.proves.map(renderProves)].join('\n'))
  }
  return parts.join('\n\n')
}

function renderImpactNode(node: ImpactNode, depth: number): string[] {
  const pad = '  '.repeat(depth)
  const arrow = depth === 0 ? '' : '└─ '
  // Not "shown above": the roots come out in file order, so a repeat can appear before the
  // place it is expanded.
  if (node.kind === 'repeated') return [`${pad}${arrow}${node.fn.name}  (shown elsewhere)`]

  const lines = [`${pad}${arrow}${node.fn.name}  ${node.fn.file}:${node.fn.from}`]
  for (const test of node.tests) lines.push(`${pad}  [test] ${test.file}:${test.line}`)
  for (const caller of node.callers) lines.push(...renderImpactNode(caller, depth + 1))
  return lines
}

function renderProves(proves: TestProves): string {
  const lines = [proves.file]
  for (const requirement of proves.requirements) {
    lines.push(`  ${requirement.capability} → ${requirement.requirement}${where(requirement.spec)}`)
    lines.push(...requirement.scenarios.map(scenario => `     · ${scenario}`))
  }
  return lines.join('\n')
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
