import { appendFileSync } from 'node:fs'
import { afterEach, beforeEach } from 'vitest'
import { functionsRun } from '../impact/index.ts'
import { DEFAULT_COVERAGE_FILE, type TestRunLine } from './record.ts'

/**
 * A vitest setup file that records what each test ran, so `proofspec impact` can say which
 * scenarios executed a change rather than which files could have. Add it to `setupFiles`
 * with istanbul coverage on; see `docs/coverage.md`.
 *
 * This is glue, like `cli/main.ts`: it snapshots the counters around each test and appends a
 * line. The one decision worth a test — that a test owns only the counters that moved while
 * it ran — lives in `impact.functionsRun`, which is proven there.
 *
 * It writes on `afterEach` rather than collecting to the end, because vitest runs test files
 * in separate workers: there is no end shared between them, only a file they can all append
 * to. The global setup truncates it once before the run.
 */

type FileCoverage = {
  readonly path: string
  readonly f: Record<string, number>
  readonly fnMap: Record<string, { readonly name: string }>
}

/** Where the istanbul provider keeps its counters inside a vitest worker. */
function coverage(): Record<string, FileCoverage> {
  return (globalThis as { __VITEST_COVERAGE__?: Record<string, FileCoverage> }).__VITEST_COVERAGE__ ?? {}
}

type Counts = Record<string, Record<string, number>>

function snapshot(): Counts {
  const counts: Counts = {}
  for (const [file, data] of Object.entries(coverage())) counts[file] = { ...data.f }
  return counts
}

const out = process.env.PROOFSPEC_COVERAGE ?? DEFAULT_COVERAGE_FILE
const root = `${process.cwd()}/`
let before: Counts = {}

beforeEach(() => {
  before = snapshot()
})

afterEach(context => {
  const after = snapshot()
  const held = coverage()
  // Nothing is instrumented, so there is nothing this test can be said to have run. Writing a
  // record of no functions would look like a test that ran none, which is a different claim.
  if (Object.keys(held).length === 0) return
  const ran = Object.entries(after).flatMap(([file, counts]) => {
    const names = functionsRun({
      before: before[file] ?? {},
      after: counts,
      names: namesOf(held[file]),
    })
    // Paths are reported the way every other proofspec path is: relative to the repo root.
    return names.length === 0 ? [] : [{ file: file.startsWith(root) ? file.slice(root.length) : file, names }]
  })

  const task = context.task as { name?: string; location?: { line?: number }; file?: { name?: string } }
  const line = task.location?.line
  const file = task.file?.name
  // A test with no location cannot be joined to the scenario it proves; `includeTaskLocation`
  // is what turns it on, and the docs say to. Dropping it beats writing a record that would
  // silently match the wrong proof.
  if (line === undefined || file === undefined) return

  const record: TestRunLine = { file: file.startsWith(root) ? file.slice(root.length) : file, line, ran }
  appendFileSync(out, `${JSON.stringify(record)}\n`)
})

function namesOf(file: FileCoverage | undefined): Record<string, string> {
  if (file === undefined) return {}
  return Object.fromEntries(Object.entries(file.fnMap).map(([id, fn]) => [id, fn.name]))
}
