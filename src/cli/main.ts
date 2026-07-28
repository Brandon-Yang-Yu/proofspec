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

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    specs: { type: 'string' },
    tests: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
})

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
