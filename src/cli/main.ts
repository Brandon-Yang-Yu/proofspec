#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { check, docket, impact, inflight, render, review, schedule, touched, write } from './run.ts'
import { serveDocket } from './serve.ts'
import { piJudge } from './judge.ts'
import { stderrNotifyHuman } from './notify.ts'
import { exitCodeOf, FORMATS, isFormat, renderAnswer } from './render.ts'
import { listTmuxSessions, liveSessionCount, tmuxStartSession } from './session.ts'
import type { Format, Layout } from './render.ts'
import type { Outcome, ProposedInput, ProposedRuling, RunOptions, TouchedAsk } from './types.ts'

/**
 * The command line the commands are actually run from. This is thin glue: it parses the
 * locations, the `--out` path, and the `--json` switch, calls the command, prints the
 * answer, and exits. Every decision worth a test lives in `run`/`render`; nothing here does.
 *
 * The `package.json` bin points at this file's compiled form in `dist/`; in the repo it
 * also runs straight from source via `pnpm proofspec`. Either way it is the one piece of
 * `cli` that does not need a test to be right.
 */

const USAGE = `proofspec — the test suite is the living spec

Usage: proofspec <command> [options]

Commands:
  check    Rebuild the spec tree from the tests and report drift; never writes.
           Exits 0 when the tests and the committed files agree, non-zero when they do not.
  write    Record what the tests prove into the committed capability files.
  render   Write the readable spec site (an index, the full spec in one page, and one
           page per capability).
  touched  Say what this branch's changes touched. Given nothing in particular, it answers
           with the work list — one line per requirement reached, with the address to fetch
           it by and how much of it nobody has judged — and exits non-zero while anything is
           left unjudged, so a hook can hold the gate. Fetching always exits zero.
  review   Record one reviewer's judgement of one promise the change reached, into
           .proofspec/reviews.jsonl. A pass has to cite the line that proves the claim.
  impact   Walk from the source this branch changed, up the call graph, to the tests that
           reach it and the requirements they prove. Needs a codebase-memory index.
  inflight Read the conventional queue directory and answer how the in-flight TASK found there
           relate to one another. Reports only, and always exits ok.
  schedule Run one scheduling pass over the queue: settle a mergeable TASK whose branch has landed
           in the base branch, prune a merged TASK nothing still names, dispatch every ready TASK, and raise an
           unresolved relationship at most once. Given
           --ruling, records a human's ruling on an already-raised relationship instead.
           The bare command line supplies real startSession, judge, and notifyHuman actions
           itself: a ready TASK starts a headed executor session in a detached tmux session
           named for the TASK, in the TASK's agent harness: the one its queue entry's
           executor file names (pi or claude), else the settings file's executor (pi by
           default); a relationship is judged by a fresh one-shot process running the
           settings file's judgeBin (pi by default, claude headless), waiting at most its
           judgeTimeoutMs (60000 by default); and
           one it cannot resolve is reported to stderr naming both TASKs and how
           to rule on it. No session starts once the live-session bound is reached (the
           settings file's maxSessions, four by default). An embedder passing RunOptions may
           still override any of the actions.
  docket   One glance at the queue: a row per TASK in the conventional queue directory — its own
           state word, how long it has stood there, when its session last moved, and whether
           that session is still there to attach to — plus every relationship raised but not
           yet ruled, each with the exact command that records a ruling. Text by default,
           JSON with --format json. Reports only: writes nothing, judges nothing, always ok.
           With --serve it answers the same docket as a page over HTTP: the page at /, the
           JSON the page reads at /docket, on the loopback at a port derived from the queue
           root (--host and --port to override), refreshing itself, until stopped.

Settings:
  The project's settings live in one committed file, .proofspec/config.json, read from the
  main checkout even when a command runs inside a TASK's worktree. Every key is optional; a
  key missing, or holding a value that cannot be used, takes its default. A file that is not
  valid JSON fails the command, naming the file.
  executor        The harness an executor session runs: pi or claude (default: pi)
  baseBranch      The branch the queue measures against (default: main)
  judgeBin        The program the judge runs (default: pi)
  judgeTimeoutMs  How long the judge waits for an answer (default: 60000)
  maxSessions     How many executor sessions may run at once (default: 4)

Options:
  --specs <dir>   Where the capability files live (default: specs)
  --tests <dir>   Where the tests live (default: tests)
  --out <dir>     Where render writes its pages (default: build)
  --since <rev>   What touched and impact compare against (default: the branch point)
  --graph <file>  A call graph for impact to walk, instead of the indexed one
  --project <id>  The indexed project impact reads (default: derived from the directory)
  --depth <n>     How far up the call chain impact walks (default: 4)
  --coverage <f>  What a test run recorded, narrowing impact to the scenarios that ran
  --requirement <key>  Ask touched for one requirement in full, by the address the work
                  list gives it
  --unmatched     Ask touched for the changed lines that fall in no proof
  --verdict <v>   What a review concluded: ok, gap, or drift
  --proves <line> The line that proves the claim. Required by a pass, and checked
  --note <text>   What is wrong with the claim. Required by a gap or a drift
  --by <who>      Who made the review. Always required: an unsigned judgement is one
                  nobody can be asked about
  --ruling <text> A human's own ruling on the relationship named by schedule's one positional —
                  the key a raised relationship was reported under. Records it rather than
                  running a scheduling pass.
  --format <fmt>  Output format: text, json, quickfix, diagnostics. Left out, touched
                  answers as JSON and everything else as text.
  --serve         The docket command answers the page over HTTP instead of printing an
                  answer, and runs until stopped (docket only)
  --port <n>      The port docket --serve listens on (default: derived from the queue root)
  --host <addr>   The interface docket --serve listens on (default: the loopback)
  --json          The legacy spelling of --format json; touched answers that way anyway
  --pretty        Lay the JSON answer out over indented lines for a person to read. Without
                  it the JSON is the one line a program parses, unchanged.
  -h, --help      Show this help`

// parseArgs throws on an unknown flag; catch it so a mistyped option prints the usage rather
// than a stack trace — the same help a bare `-h` asks for.
let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      specs: { type: 'string' },
      tests: { type: 'string' },
      out: { type: 'string' },
      since: { type: 'string' },
      graph: { type: 'string' },
      project: { type: 'string' },
      depth: { type: 'string' },
      coverage: { type: 'string' },
      requirement: { type: 'string' },
      unmatched: { type: 'boolean', default: false },
      serve: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      verdict: { type: 'string' },
      proves: { type: 'string' },
      note: { type: 'string' },
      by: { type: 'string' },
      ruling: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`)
  process.exit(2)
}

const { values, positionals } = parsed

// Normalize format: --json is the legacy spelling of --format json. Left unnamed it stays
// undefined, and `renderAnswer` picks the default the answer's reader expects.
const rawFormat = values.format ?? (values.json ? 'json' : undefined)
if (rawFormat !== undefined && !isFormat(rawFormat)) {
  process.stderr.write(`Invalid format: ${rawFormat}. Use ${FORMATS.map(name => `'${name}'`).join(', ')}.\n\n${USAGE}\n`)
  process.exit(2)
}
const format: Format | undefined = rawFormat
// `--pretty` only lays out a JSON answer; a text one is already written for a person to read.
const layout: Layout = values.pretty ? 'indented' : 'compact'

// `--help`, or no command at all, prints the usage and stops before any file is touched.
if (values.help || positionals[0] === undefined) {
  process.stdout.write(`${USAGE}\n`)
  process.exit(0)
}

// Which of touched's three answers was asked for. `TouchedAsk` is a union, so two of these
// flags at once is not something it can hold — refused here for the same reason an unknown
// --format is: this is the one thing the parser decides, and it decides only what the options
// can represent. What a verdict may *be* is a decision about a value, so `review` makes it.
if (values.requirement !== undefined && values.unmatched) {
  process.stderr.write(`Ask for one requirement or for the unmatched lines, not both.\n\n${USAGE}\n`)
  process.exit(2)
}
const ask: TouchedAsk | undefined = askedFor(values.requirement, values.unmatched)

const options: RunOptions = {
  cwd: process.cwd(),
  ask,
  review: values.verdict === undefined ? undefined : reviewOf(values.verdict, positionals[1]),
  ruling: values.ruling === undefined ? undefined : rulingOf(values.ruling, positionals[1]),
  // The bare command line's own real actions — see the `schedule` usage text above.
  schedule: {
    startSession: task => tmuxStartSession(process.cwd(), task),
    countSessions: () => liveSessionCount(process.cwd()),
    judge: piJudge(),
    notifyHuman: stderrNotifyHuman(),
  },
  docket: {
    listSessions: () => listTmuxSessions(process.cwd()),
  },
  specsDir: values.specs,
  testsDir: values.tests,
  out: values.out,
  since: values.since,
  graph: values.graph,
  project: values.project,
  depth: values.depth === undefined ? undefined : Number(values.depth),
  coverage: values.coverage,
}
// `docket --serve` is the one form that does not answer and exit: it answers sockets until
// stopped. It branches before the answer flow, and the listener itself is what keeps the
// process alive after it — Ctrl-C ends the process, and the port goes back with it.
if (positionals[0] === 'docket' && values.serve) {
  await serveUntilStopped(values.port, values.host)
} else {
  const outcome = await runCommand(positionals[0], options)

  const answer = renderAnswer(outcome, { format, layout })
  process.stdout.write(`${answer}\n`)
  // The code is set rather than exited on: a write to a pipe is asynchronous, so calling
  // `process.exit` here truncates the answer at the pipe buffer — 64KB, which an indented
  // report of a real branch passes easily. Nothing keeps the loop alive, so it ends anyway.
  process.exitCode = exitCodeOf(outcome)
}

/** A port as typed, or nothing when what was typed names no port — the same pre-answer
 *  refusal every malformed option gets. */
function portNumber(raw: string): number | undefined {
  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined
}

/** Serves the docket and returns only when serving is over: either the interface or port
 *  it was asked for could not be listened on (a refusal, exit 2), or the process is stopped
 *  by hand and never returns here at all. */
async function serveUntilStopped(rawPort: string | undefined, rawHost: string | undefined): Promise<void> {
  const port = rawPort === undefined ? undefined : portNumber(rawPort)
  if (rawPort !== undefined && port === undefined) {
    process.stderr.write(`--port needs a port number, got "${rawPort}".\n\n${USAGE}\n`)
    process.exit(2)
  }
  const served = await serveDocket({ cwd: process.cwd(), port, host: rawHost, docket: { listSessions: () => listTmuxSessions(process.cwd()) } })
  if (!served.ok) {
    process.stderr.write(`${served.reason}\n`)
    process.exit(2)
  }
  process.stdout.write(`serving the docket at ${served.url} — Ctrl-C stops it\n`)
}

/**
 * The review as typed. `review` takes the key as its one positional, so a missing one is
 * reported as missing rather than left to surface as a promise nothing is filed at. Whether
 * the verdict names anything is not decided here — that is a value, and `review` owns it.
 */
function reviewOf(verdict: string, key: string | undefined): ProposedInput {
  if (key === undefined) {
    process.stderr.write(`review needs the key of the promise to judge.\n\n${USAGE}\n`)
    process.exit(2)
  }
  return {
    key,
    verdict,
    proves: values.proves === undefined ? undefined : Number(values.proves),
    note: values.note,
    by: values.by,
  }
}

/**
 * The ruling as typed. `schedule` takes the key as its one positional the same way `review`
 * does, so a missing one is reported as missing rather than recorded against nothing.
 */
function rulingOf(ruling: string, key: string | undefined): ProposedRuling {
  if (key === undefined) {
    process.stderr.write(`schedule needs the key of the relationship to rule on.\n\n${USAGE}\n`)
    process.exit(2)
  }
  return { key, ruling }
}

function askedFor(requirement: string | undefined, unmatched: boolean): TouchedAsk | undefined {
  if (requirement !== undefined) return { kind: 'requirement', key: requirement }
  if (unmatched) return { kind: 'unmatched' }
  return undefined
}

function runCommand(command: string | undefined, options: RunOptions): Promise<Outcome> {
  if (command === 'check') return check(options)
  if (command === 'write') return write(options)
  if (command === 'render') return render(options)
  if (command === 'touched') return touched(options)
  if (command === 'review') return review(options)
  if (command === 'impact') return impact(options)
  if (command === 'inflight') return inflight(options)
  if (command === 'docket') return docket(options)
  if (command === 'schedule') return schedule(options)
  const named = command === undefined ? 'no command' : `unknown command "${command}"`
  return Promise.resolve({
    kind: 'cannot-run',
    reason: `${named}. Use "check", "write", "render", "touched", "review", "impact", "inflight", "docket", or "schedule".`,
  })
}


