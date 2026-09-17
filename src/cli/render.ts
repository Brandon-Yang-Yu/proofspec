import { assertNever } from '../assert-never.ts'
import type { Graph, Node, Relationship, TaskEntry } from '../inflight/index.ts'
import type { Docket, DocketRow, OutstandingRuling } from '../docket/index.ts'
import { describeFinding, severityOf, type Finding } from '../guard/index.ts'
import type { ImpactNode } from '../impact/index.ts'
import type { ReviewEntry } from '../review/index.ts'
import type { RaisedEntry, SchedulePlan } from '../schedule/index.ts'
import type {
  GoneScenario,
  ImpactReport,
  Outcome,
  ReachedRequirement,
  SpecLocation,
  StandingReview,
  StandardChange,
  TestProves,
  TouchedReport,
  TouchedRequirement,
  TouchedScenarioReport,
  TouchedSummary,
  TouchedUnmatched,
  UnmatchedLines,
} from './types.ts'

/**
 * Turns an `Outcome` into the things the process boundary needs: an exit code, a line for a
 * person, a line for a program — and, when the caller named no format, the choice of which of
 * those two an answer is given in. This is where a verdict becomes a number — the boundary
 * `guard` deliberately stopped short of.
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
    case 'reviewed':
      return EXIT_OK
    // Naming a promise this change touched — even one nothing proves any more — is not the tool
    // saying the build is wrong; that verdict is the check's to give. What the work list does
    // hold is a gate on the reviewing: while a promise it reached is unjudged it exits the same
    // 1 the check uses, and no reader is left guessing which to fix, because the two commands
    // send them to different places — the check to the spec, this to the review.
    //
    // Only the work list holds it. Fetching one requirement, or the lines that prove nothing,
    // is how a reviewer collects the work, and an agent that read every fetch as a failed tool
    // would stop partway through the job the gate exists to make it finish.
    case 'touched':
      return unjudgedIn(outcome.report) ? EXIT_DRIFT : EXIT_OK
    case 'impact':
      return EXIT_OK
    // A relationship the graph found, or a problem one of its TASK carries, is not a build
    // this command is entitled to fail — the same way `impact`'s tree never fails a build.
    case 'inflight':
    // The docket's rows, problems, and outstanding rulings are facts about the queue, not
    // verdicts on it — reporting them holds no gate, exactly as `inflight` does not.
    case 'docket':
    // What a scheduling pass did, or a recorded ruling, are reports of an action taken, not a
    // verdict on the build.
    case 'scheduled':
    case 'ruled':
      return EXIT_OK
    case 'cannot-run':
      return EXIT_CANNOT_RUN
    default:
      return assertNever(outcome)
  }
}

/** Whether the work list still counts a promise nobody has judged. */
function unjudgedIn(report: TouchedReport): boolean {
  if (report.kind !== 'summary') return false
  return report.requirements.some(one => one.pending > 0)
}

/** The shapes an answer can take: one for a person, three for a program. */
export type Format = 'text' | 'json' | 'quickfix' | 'diagnostics'
export const FORMATS: readonly Format[] = ['text', 'json', 'quickfix', 'diagnostics']

/** Whether a string off the command line names a format, so the boundary parses rather than casts. */
export function isFormat(value: string): value is Format {
  return FORMATS.includes(value as Format)
}

/**
 * How a JSON answer is laid out. One line is what a program parses and what a pipe carries;
 * indented is the same answer with its structure visible, for the person reviewing it.
 */
export type Layout = 'compact' | 'indented'

/** What shape an answer is asked for in: which format, and how a JSON one is laid out. */
export type AnswerShape = {
  readonly format?: Format
  readonly layout?: Layout
}

/** The answer in the format asked for, or in the one its reader expects when none is. */
export function renderAnswer(outcome: Outcome, { format, layout = 'compact' }: AnswerShape = {}): string {
  const chosen = format ?? defaultFormatOf(outcome)
  switch (chosen) {
    case 'json':
      return renderJson(outcome, layout)
    case 'quickfix':
      return renderQuickfix(outcome)
    case 'diagnostics':
      return renderDiagnostics(outcome, layout)
    case 'text':
      return renderText(outcome)
    default:
      return assertNever(chosen)
  }
}

/**
 * Which format an answer is given in when the caller named none.
 *
 * Only `touched` defaults to JSON. It is read by an agent far more often than by a person, and
 * an agent should not have to remember a flag to be answered in its own language. Every other
 * answer defaults to text, `impact` included — a decision rather than an oversight: `impact` is
 * a tree a person reads down, and nobody has yet asked to consume it as data. This is a switch
 * so that a sixth kind of answer cannot be absorbed into one branch without someone choosing.
 */
function defaultFormatOf(outcome: Outcome): Format {
  switch (outcome.kind) {
    case 'touched':
    // Read by another program — an orchestrator, in a later round — far more often than by a
    // person, the same reason `touched` defaults to JSON.
    case 'inflight':
      return 'json'
    // A person at a terminal watching several TASKs run is the reader the docket exists for,
    // so its default is the mirror image of `inflight`'s: text for a person, JSON on request.
    case 'docket':
      return 'text'
    case 'checked':
    case 'wrote':
    case 'reviewed':
    // What a scheduling pass did, or a recorded ruling: an action report a person triggering it
    // by hand reads, the same shape as `wrote` and `reviewed`.
    case 'scheduled':
    case 'ruled':
    case 'impact':
    case 'cannot-run':
      return 'text'
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
    case 'reviewed':
      return renderReviewed(outcome.entry)
    case 'impact':
      return renderImpact(outcome.report)
    case 'inflight':
      return renderInflight(outcome.report)
    case 'docket':
      return renderDocket(outcome.report)
    case 'scheduled':
      return renderScheduled(outcome.report)
    case 'ruled':
      return renderRuled(outcome.entry)
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
export function renderJson(outcome: Outcome, layout: Layout = 'compact'): string {
  switch (outcome.kind) {
    case 'checked':
      return stringify(outcome.report, layout)
    case 'wrote':
      return stringify({ changed: outcome.files }, layout)
    case 'touched':
    case 'impact':
    case 'inflight':
    case 'docket':
    case 'scheduled':
      return stringify(outcome.report, layout)
    case 'reviewed':
    case 'ruled':
      return stringify(outcome.entry, layout)
    case 'cannot-run':
      return stringify({ error: outcome.reason }, layout)
    default:
      return assertNever(outcome)
  }
}

const JSON_INDENT = 2

/**
 * The one place a JSON answer's layout is applied, so every command lays out the same way and
 * the compact form stays the one a caller who asked for nothing gets, byte for byte.
 */
function stringify(value: unknown, layout: Layout): string {
  return layout === 'indented' ? JSON.stringify(value, undefined, JSON_INDENT) : JSON.stringify(value)
}

/** What a change touched, as a person reads it — one form for each of the three answers. */
function renderTouched(report: TouchedReport): string {
  if (report.kind === 'summary') return renderWorkList(report)
  if (report.kind === 'unmatched') return renderUnmatchedLines(report)
  return renderOneRequirement(report)
}

/**
 * The work list. Each line carries the address to fetch it by, so a person reading this in a
 * terminal can copy one and ask for it — the same move the agent makes, which is what keeps
 * the two readers on one workflow rather than two.
 */
function renderWorkList(report: TouchedSummary): string {
  if (report.requirements.length === 0 && report.unmatched === 0) {
    return `nothing touched since ${report.base}`
  }

  const unjudged = report.requirements.reduce((count, one) => count + one.pending, 0)
  const parts = [`touched since ${report.base} — ${unjudged} promise(s) still unjudged`]
  if (report.requirements.length > 0) parts.push(report.requirements.map(renderReached).join('\n'))
  if (report.unmatched > 0) {
    parts.push(`${report.unmatched} changed run(s) prove nothing — ask for them with --unmatched`)
  }
  return parts.join('\n\n')
}

function renderReached(one: ReachedRequirement): string {
  const reached = `${one.scenarios} touched, ${one.gone} gone`
  return `  ${one.key}  ${one.capability} → ${one.requirement}\n      ${reached}, ${one.pending} unjudged`
}

/**
 * One requirement in full. Each line a reader can act on starts with the place to open —
 * `file:line` — with the key to record a judgement against under it, so the two questions this
 * answer raises ("which claim is this?" and "how do I say I have read it?") are both answered
 * without leaving the report. The scenarios stay in file order, which is how a person walks a
 * diff.
 */
function renderOneRequirement(report: TouchedRequirement): string {
  const parts = [
    `${report.capability} → ${report.requirement}${where(report.spec)}`,
    // All three, not only the question. The terminal form is the one a person reads, and a
    // person told what to look for but not how to answer goes off to find out — which is the
    // errand carrying the protocol at all was meant to save.
    [report.review.judge, '', `  pass:   ${report.review.pass}`, `  report: ${report.review.report}`].join('\n'),
  ]
  if (report.scenarios.length > 0) parts.push(report.scenarios.map(renderTouchedScenario).join('\n'))
  if (report.gone.length > 0) {
    parts.push(['no longer proven:', ...report.gone.map(renderGone)].join('\n'))
  }
  return parts.join('\n\n')
}

/**
 * The claim is the promise itself, so which half moved is the difference between "review this
 * sentence", "review this test", and "the author moved both — check they still agree". A
 * redefined term is the fourth case: nothing in the file moved, and the meaning did. A
 * reworded description is the fifth: the standard every scenario under the requirement is
 * judged against moved, and the claim was left standing under it.
 */
const CHANGED_LABEL: Record<TouchedScenarioReport['changed'], string> = {
  claim: '[the claim changed]',
  proof: '[the proof changed]',
  both: '[claim and proof changed]',
  term: '[a term it uses was redefined]',
  description: "[its requirement's description moved]",
}

function renderTouchedScenario(scenario: TouchedScenarioReport): string {
  return [
    `${scenario.file}:${scenario.from}  ${scenario.scenario}  ${CHANGED_LABEL[scenario.changed]}`,
    ...renderReopened(scenario.reopenedBy),
    `    ${scenario.key}  ${judgement(scenario.reviewed)}`,
  ].join('\n')
}

/**
 * What a promise is now judged under, when something on the spec side re-opened it. Both
 * versions when the meaning or the wording moved, because the distance it moved is the
 * whole of what the reviewer was asked about.
 */
function renderReopened(changes: readonly StandardChange[] | undefined): readonly string[] {
  if (changes === undefined) return []
  return changes.flatMap(change => {
    switch (change.kind) {
      case 'reworded':
        return [`    ${change.term} was: ${change.before}`, `    ${change.term} now: ${change.after}`]
      case 'new':
        return [`    ${change.term} now: ${change.after} (newly defined)`]
      case 'gone':
        return [`    ${change.term} was: ${change.before} (no longer defined)`]
      case 'description-reworded':
        return [`    the description was: ${change.before}`, `    the description now: ${change.after}`]
      case 'description-new':
        return [`    the description now: ${change.after} (the requirement is newly written)`]
    }
  })
}

function renderUnmatchedLines(report: TouchedUnmatched): string {
  if (report.lines.length === 0) return `nothing outside every proof changed since ${report.base}`
  return [`changed outside every proof, since ${report.base}`, ...report.lines.map(renderUnmatched)].join('\n')
}

/**
 * One run of changed lines no promise owns, as written. Untrimmed: the indentation is part of
 * what changed, and a reader deciding whether a helper edit matters reads it off the shape of
 * the line. The run goes under its position rather than beside it, because a run of several
 * lines beside a prefix puts the first at one column and the rest at another.
 */
function renderUnmatched(lines: UnmatchedLines): string {
  const at = lines.from === lines.to ? `${lines.from}` : `${lines.from}-${lines.to}`
  return [`${lines.file}:${at}`, ...lines.source.split('\n').map(line => `    ${line}`)].join('\n')
}

function renderGone(scenario: GoneScenario): string {
  return `${scenario.file}  ${scenario.scenario}\n    ${scenario.key}  ${judgement(scenario.reviewed)}`
}

/** What a reviewer said about a promise, or that the gate is still waiting on one. */
function judgement(reviewed: StandingReview | undefined): string {
  return reviewed === undefined ? 'unjudged' : `${reviewed.verdict} — ${reviewed.by}`
}

/** One recorded judgement, said back so the reviewer sees what went into the ledger. */
function renderReviewed(entry: ReviewEntry): string {
  return `${entry.verdict}  ${entry.scenario}\n    ${backingOf(entry)}\n    by ${entry.by}`
}

/** What a recorded judgement rests on. A pass on a removed proof rests on nothing left to cite. */
function backingOf(entry: ReviewEntry): string {
  if (entry.verdict !== 'ok') return entry.note
  if (entry.cites === undefined) return 'the promise was meant to die'
  return `cites ${entry.cites.line}: ${entry.cites.source.trim()}`
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
    // Which of the two views this is matters: the graph's list is a superset kept
    // deliberately wide, a run's list is exactly what executed the change.
    const heading = report.from === 'test-run' ? 'to review (these ran the change):' : 'to review (these can reach it):'
    parts.push([heading, ...report.proves.map(renderProves)].join('\n'))
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

/**
 * The graph as a person reads it: one line per TASK, then the relationships between them. A
 * TASK carrying a problem still shows its writes and reopened edges — a problem rides beside
 * what could be read, not instead of it.
 */
function renderInflight(graph: Graph): string {
  if (graph.tasks.length === 0) return 'no TASK in flight'
  const parts = [graph.tasks.map(renderTask).join('\n')]
  if (graph.relationships.length > 0) {
    parts.push(['relationships:', ...graph.relationships.map(renderRelationship)].join('\n'))
  }
  return parts.join('\n\n')
}

function renderTask(task: TaskEntry): string {
  const lines = [
    `${task.task}  writes: ${nodeList(task.writes)}  reopened: ${nodeList(task.reopened)}`,
    task.basedOn === null ? undefined : `    basedOn ${task.basedOn.task} (${task.basedOn.reason})`,
    task.problem === null ? undefined : `    problem: ${task.problem}`,
  ]
  return lines.filter(line => line !== undefined).join('\n')
}

function renderRelationship(relationship: Relationship): string {
  return `  ${nodeLabel(relationship.node)}: ${relationship.tasks.join(', ')}`
}

/** What one scheduling pass did, as a person reads it. */
function renderScheduled(plan: SchedulePlan): string {
  const parts = [plan.merged, plan.pruned, plan.started, plan.blocked, plan.deferred, plan.raised]
  if (parts.every(list => list.length === 0)) return 'nothing to do'
  const lines = [
    ...plan.merged.map(task => `merged ${task} (branch landed in main)`),
    ...plan.pruned.map(task => `pruned ${task}`),
    ...plan.started.map(task => `started ${task}`),
    ...plan.blocked.map(task => `blocked ${task} (a LEASE already stands)`),
    ...plan.deferred.map(task => `deferred ${task} (the live-session bound is reached)`),
    ...plan.raised.map(relationship => `raised ${nodeLabel(relationship.node)}: ${relationship.tasks.join(', ')}`),
  ]
  return lines.join('\n')
}

/** One recorded ruling, said back so the person who wrote it sees what was filed. */
function renderRuled(entry: Extract<RaisedEntry, { readonly kind: 'ruled' }>): string {
  return `ruled ${entry.key}\n    ${entry.ruling}`
}

/**
 * The docket as a person reads it: one line per TASK, then the problems that kept a TASK off
 * the rows, then the rulings still outstanding — each with the exact command that pays it.
 * The ages are laid out for a person ("2h 5m", not a number of seconds); the JSON form carries
 * the same content as plain seconds, which is what a program wants.
 */
function renderDocket(report: Docket): string {
  if (report.rows.length === 0 && report.problems.length === 0 && report.outstanding.length === 0) {
    return 'no TASK in the queue'
  }
  const parts: string[] = []
  if (report.rows.length > 0) parts.push(report.rows.map(renderDocketRow).join('\n'))
  if (report.problems.length > 0) {
    parts.push(['problems:', ...report.problems.map(problem => `  ${problem.task}: ${problem.reason}`)].join('\n'))
  }
  if (report.outstanding.length > 0) {
    parts.push(['rulings outstanding:', ...report.outstanding.map(renderOutstanding)].join('\n'))
  }
  return parts.join('\n\n')
}

function renderDocketRow(row: DocketRow): string {
  const pace = row.phase === null ? 'no phase' : `${row.phase} (round ${row.round})`
  const inState = `in state ${humanAge(row.stateAgeSeconds)}`
  const inPhase = row.phaseAgeSeconds === null ? 'no phase' : `in phase ${humanAge(row.phaseAgeSeconds)}`
  const sinceMove = row.heartbeatAgeSeconds === null ? 'no heartbeat' : `moved ${humanAge(row.heartbeatAgeSeconds)} ago`
  const session = row.session.listed ? row.session.attach : 'no session'
  return `  ${row.task}  ${row.state}  ${pace}  on ${row.branch} from ${baseLabel(row.base)}  ${inState}  ${inPhase}  ${sinceMove}  ${session}`
}

function renderOutstanding(ruling: OutstandingRuling): string {
  const shared = ruling.node === null ? 'a relationship this key does not name' : `${ruling.node.kind} "${ruling.node.name}"`
  const tasks = ruling.tasks.length === 0 ? '' : ` shared by ${ruling.tasks.join(', ')}`
  return `  ${shared}${tasks}\n    ${ruling.answerWith}`
}

/** A base as one word on a row: `main`, or the TASK this one was built on. */
function baseLabel(base: DocketRow['base']): string {
  return base.kind === 'main' ? 'main' : base.task
}

/** An age as a person reads it off a queue: seconds, then minutes, then the two-part spans a
 *  long-running TASK actually stands at. */
function humanAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`
}

function nodeList(nodes: readonly Node[]): string {
  return nodes.length === 0 ? 'none' : nodes.map(nodeLabel).join(', ')
}

function nodeLabel(node: Node): string {
  return `${node.kind}:${node.name}`
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
export function renderDiagnostics(outcome: Outcome, layout: Layout = 'compact'): string {
  if (outcome.kind !== 'checked') {
    return renderJson(outcome, layout)
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

  return stringify({ diagnostics }, layout)
}
