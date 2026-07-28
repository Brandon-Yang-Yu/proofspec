import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { guard } from '../guard/index.ts'
import { renderSite } from '../locate/index.ts'
import { readCapabilityFile, updateScenarioBlocks } from '../spec-file/index.ts'
import { buildTree } from '../spec-tree/index.ts'
import type { SpecTree } from '../spec-tree/index.ts'
import { scanSource } from '../test-scan/index.ts'
import type { ScanError } from '../test-scan/index.ts'
import { readSpecFiles, readTestFiles } from './discover.ts'
import type { SourceFile, SpecFileRead } from './discover.ts'
import type { Outcome, RunOptions } from './types.ts'

/**
 * The commands people and CI run. Each opens the repo's files, hands them to the library
 * capabilities, and returns what happened as a value. `check` reads and reports; `write`
 * records; `render` delivers the readable view. Keeping them as separate functions rather
 * than one with a mode keeps each doing a single thing, while the shared reading lives in
 * `gather`.
 */

const DEFAULT_SPECS_DIR = 'specs'
const DEFAULT_TESTS_DIR = 'tests'
const DEFAULT_OUT = 'build'

/**
 * Scans the tests, reads the committed capability files, and reports whether they agree.
 * It never writes: a check that quietly fixed what it found would pass on a repo that was
 * wrong until the moment it ran.
 */
export async function check(options: RunOptions): Promise<Outcome> {
  const inputs = await gather(options)
  if (!inputs.ok) return { kind: 'cannot-run', reason: inputs.reason }

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  const committed: SpecTree = {
    capabilities: inputs.specs.map(file => readCapabilityFile(file.source, { capability: file.capability })),
  }
  return { kind: 'checked', report: guard({ scans, committed }) }
}

/**
 * Records what the tests prove in the committed files, and changes nothing else — the
 * write-back of design.md §6, run on purpose. Each capability file gets the scenarios its
 * tests prove; a file whose bytes would not change is left untouched, so the changed list
 * says exactly what moved.
 */
export async function write(options: RunOptions): Promise<Outcome> {
  const inputs = await gather(options)
  if (!inputs.ok) return { kind: 'cannot-run', reason: inputs.reason }

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  // A command that writes must not act on tests it could not fully read. The scan errors
  // surface at `check` too, but `check` runs after the write would already have changed the
  // files; refusing here keeps `write` safe to run without a green check in front of it.
  const unreadable = scans.flatMap(scan => scan.errors)
  if (unreadable.length > 0) return { kind: 'cannot-run', reason: reasonFor(unreadable) }

  const sites = scans.flatMap(scan => scan.sites)
  const { tree } = buildTree(sites)

  const changed: string[] = []
  for (const spec of inputs.specs) {
    const node = tree.capabilities.find(capability => capability.capability === spec.capability)
    const next = updateScenarioBlocks(spec.source, { requirements: node?.requirements ?? [] })
    if (next === spec.source) continue
    await writeFile(join(options.cwd, spec.path), next)
    changed.push(spec.path)
  }
  return { kind: 'wrote', files: changed }
}

/**
 * Writes the readable spec site — the delivery view of design.md §4 — as one page per
 * capability plus an index, under the output directory. It scans the tests for the Gherkin
 * and positions and reads the committed files for the descriptions, joins them, and writes
 * the pages. They are an output a person reads, never an input the tool reads back, so unlike
 * `write` it always writes rather than skipping a page whose bytes would not change.
 */
export async function render(options: RunOptions): Promise<Outcome> {
  const inputs = await gather(options)
  if (!inputs.ok) return { kind: 'cannot-run', reason: inputs.reason }

  const sites = inputs.tests.flatMap(file => scanSource(file.source, { file: file.path }).sites)
  const specs = inputs.specs.map(file => readCapabilityFile(file.source, { capability: file.capability }))
  const pages = renderSite(specs, sites, inputs.tests)

  const dir = options.out ?? DEFAULT_OUT
  const written: string[] = []
  for (const page of pages) {
    const path = join(dir, page.path)
    const full = join(options.cwd, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, page.content)
    written.push(path)
  }
  return { kind: 'wrote', files: written }
}

/** Names the first thing the scan could not read, so the reason points at a place to look. */
function reasonFor(errors: readonly ScanError[]): string {
  const first = errors[0]!
  const rest = errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''
  return `cannot write: ${first.file}:${first.line} ${first.message}${rest}`
}

/** Both halves of a repo read, or the reason one of them could not be. */
type Gathered =
  | { readonly ok: true; readonly specs: readonly SpecFileRead[]; readonly tests: readonly SourceFile[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Reads the capability files and the tests a command works from. Either directory being
 * unreadable is a `cannot-run`, reported here once so neither command repeats the check.
 */
async function gather(options: RunOptions): Promise<Gathered> {
  const specs = await readSpecFiles(options.cwd, options.specsDir ?? DEFAULT_SPECS_DIR)
  if (!specs.ok) return specs
  const tests = await readTestFiles(options.cwd, options.testsDir ?? DEFAULT_TESTS_DIR)
  if (!tests.ok) return tests
  return { ok: true, specs: specs.files, tests: tests.files }
}
