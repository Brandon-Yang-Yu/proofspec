#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { check, render, write } from './run.ts'
import { exitCodeOf, renderJson, renderText } from './render.ts'
import type { Outcome, RunOptions } from './types.ts'

/**
 * The command line the commands are actually run from. This is thin glue: it parses the
 * locations, the `--out` path, and the `--json` switch, calls the command, prints the
 * answer, and exits. Every decision worth a test lives in `run`/`render`; nothing here does.
 *
 * It is not yet wired to a `package.json` bin — running a `.ts` file as an executable is a
 * packaging decision this repo has not taken (there is no build step), and it is the one
 * piece of `cli` that does not need one to be right.
 */

const USAGE = `proofspec — the test suite is the living spec

Usage: proofspec <command> [options]

Commands:
  check    Rebuild the spec tree from the tests and report drift; never writes.
           Exits 0 when the tests and the committed files agree, non-zero when they do not.
  write    Record what the tests prove into the committed capability files.
  render   Write the readable spec site (an index and one page per capability).

Options:
  --specs <dir>   Where the capability files live (default: specs)
  --tests <dir>   Where the tests live (default: tests)
  --out <dir>     Where render writes its pages (default: build)
  --json          Print the answer as JSON instead of text
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
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`)
  process.exit(2)
}

const { values, positionals } = parsed

// `--help`, or no command at all, prints the usage and stops before any file is touched.
if (values.help || positionals[0] === undefined) {
  process.stdout.write(`${USAGE}\n`)
  process.exit(0)
}

const options: RunOptions = { cwd: process.cwd(), specsDir: values.specs, testsDir: values.tests, out: values.out }
const outcome = await runCommand(positionals[0], options)

const answer = values.json ? renderJson(outcome) : renderText(outcome)
process.stdout.write(`${answer}\n`)
process.exit(exitCodeOf(outcome))

function runCommand(command: string | undefined, options: RunOptions): Promise<Outcome> {
  if (command === 'check') return check(options)
  if (command === 'write') return write(options)
  if (command === 'render') return render(options)
  const named = command === undefined ? 'no command' : `unknown command "${command}"`
  return Promise.resolve({ kind: 'cannot-run', reason: `${named}. Use "check", "write", or "render".` })
}
