#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { check, impact, render, touched, write } from './run.ts'
import { exitCodeOf, FORMATS, isFormat, renderAnswer } from './render.ts'
import type { Format, Layout } from './render.ts'
import type { Outcome, RunOptions } from './types.ts'

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
  touched  Name the scenarios this branch's changes touched, and where each one's
           requirement is written. Always exits zero: it reports, it does not judge.
  impact   Walk from the source this branch changed, up the call graph, to the tests that
           reach it and the requirements they prove. Needs a codebase-memory index.

Options:
  --specs <dir>   Where the capability files live (default: specs)
  --tests <dir>   Where the tests live (default: tests)
  --out <dir>     Where render writes its pages (default: build)
  --since <rev>   What touched and impact compare against (default: the branch point)
  --graph <file>  A call graph for impact to walk, instead of the indexed one
  --project <id>  The indexed project impact reads (default: derived from the directory)
  --depth <n>     How far up the call chain impact walks (default: 4)
  --coverage <f>  What a test run recorded, narrowing impact to the scenarios that ran
  --format <fmt>  Output format: text, json, quickfix, diagnostics. Left out, touched
                  answers as JSON and everything else as text.
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

const options: RunOptions = {
  cwd: process.cwd(),
  specsDir: values.specs,
  testsDir: values.tests,
  out: values.out,
  since: values.since,
  graph: values.graph,
  project: values.project,
  depth: values.depth === undefined ? undefined : Number(values.depth),
  coverage: values.coverage,
}
const outcome = await runCommand(positionals[0], options)

const answer = renderAnswer(outcome, { format, layout })
process.stdout.write(`${answer}\n`)
// The code is set rather than exited on: a write to a pipe is asynchronous, so calling
// `process.exit` here truncates the answer at the pipe buffer — 64KB, which an indented
// report of a real branch passes easily. Nothing keeps the loop alive, so it ends anyway.
process.exitCode = exitCodeOf(outcome)

function runCommand(command: string | undefined, options: RunOptions): Promise<Outcome> {
  if (command === 'check') return check(options)
  if (command === 'write') return write(options)
  if (command === 'render') return render(options)
  if (command === 'touched') return touched(options)
  if (command === 'impact') return impact(options)
  const named = command === undefined ? 'no command' : `unknown command "${command}"`
  return Promise.resolve({
    kind: 'cannot-run',
    reason: `${named}. Use "check", "write", "render", "touched", or "impact".`,
  })
}
