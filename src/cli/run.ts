import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { guard } from '../guard/index.ts'
import { renderSite, scenariosTouched } from '../locate/index.ts'
import type { LineRange, TouchedScenario } from '../locate/index.ts'
import { compareStrings } from '../order.ts'
import { readCapabilityFile, requirementLines, updateScenarioBlocks } from '../spec-file/index.ts'
import { buildTree, identityKey } from '../spec-tree/index.ts'
import type { SpecTree } from '../spec-tree/index.ts'
import { scanSource } from '../test-scan/index.ts'
import type { ProofSite, ScanError } from '../test-scan/index.ts'
import { readChangedTests, readFileAt } from './diff.ts'
import { readSpecFiles, readTestFiles } from './discover.ts'
import type { SourceFile, SpecFileRead } from './discover.ts'
import type {
  GoneScenario,
  Outcome,
  RunOptions,
  SpecLocation,
  TouchedScenarioReport,
  UnmatchedLines,
} from './types.ts'

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
  if (unreadable.length > 0) return { kind: 'cannot-run', reason: reasonFor(unreadable, 'write') }

  const sites = scans.flatMap(scan => scan.sites)
  const { tree } = buildTree(sites)

  const changed: string[] = []
  for (const spec of inputs.specs) {
    const node = tree.capabilities.find(capability => capability.capability === spec.capability)
    const next = updateScenarioBlocks(spec.source, { requirements: node?.requirements ?? [] })
    if (next === spec.source) continue
    // Anchored with `resolve` like every other cwd boundary, though discover only ever
    // reports repo-relative paths — one rule for all anchoring beats a special case.
    await writeFile(resolve(options.cwd, spec.path), next)
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

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  // The pages record what the tests prove, so a test the scan could not read is a tree the
  // pages cannot vouch for — refused the way `write` refuses, before anything is written.
  const unreadable = scans.flatMap(scan => scan.errors)
  if (unreadable.length > 0) return { kind: 'cannot-run', reason: reasonFor(unreadable, 'render') }

  const sites = scans.flatMap(scan => scan.sites)
  const specs = inputs.specs.map(file => readCapabilityFile(file.source, { capability: file.capability }))
  const pages = renderSite(specs, sites, inputs.tests)

  const dir = options.out ?? DEFAULT_OUT
  const written: string[] = []
  for (const page of pages) {
    const path = join(dir, page.path)
    // `resolve` writes to an absolute `--out` exactly, so the outcome names the files
    // where they really are; `join` would bury them under the repo root.
    const full = resolve(options.cwd, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, page.content)
    written.push(path)
  }
  return { kind: 'wrote', files: written }
}

/**
 * Names every scenario the changes since a base revision touched, and where each one's
 * requirement is written. It is the inverse of the check: not "do the tests and the files
 * agree", but "what promises did this branch put its hands on".
 *
 * It reports and never judges — `gone` names a promise nothing proves any more, and even that
 * exits zero, because failing a build on it is the check's job.
 */
export async function touched(options: RunOptions): Promise<Outcome> {
  const inputs = await gather(options)
  if (!inputs.ok) return { kind: 'cannot-run', reason: inputs.reason }

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  // A test the scan could not read may hold the very proof the change touched, so the answer
  // would be quietly incomplete — refused the way `write` and `render` refuse it.
  const unreadable = scans.flatMap(scan => scan.errors)
  if (unreadable.length > 0) return { kind: 'cannot-run', reason: reasonFor(unreadable, 'touched') }
  const sites = scans.flatMap(scan => scan.sites)

  const diff = await readChangedTests({
    cwd: options.cwd,
    testsDir: options.testsDir ?? DEFAULT_TESTS_DIR,
    since: options.since,
  })
  if (!diff.ok) return { kind: 'cannot-run', reason: diff.reason }

  const specs = specLocations(inputs.specs)
  const proven = new Set(sites.filter(hasCapability).map(site => identityKey(site)))
  const scenarios: TouchedScenarioReport[] = []
  const unmatched: UnmatchedLines[] = []
  const gone: GoneScenario[] = []

  for (const file of diff.files) {
    const here = sites.filter(site => site.file === file.path)
    const ranges = file.changed.kind === 'new-file' ? [WHOLE_FILE] : file.changed.ranges
    // A file git has never seen has no lines to compare, so nothing in it can be unmatched:
    // the whole file is new, and every proof it holds is new with it.
    const skipUnmatched = file.changed.kind === 'new-file'

    const hit = scenariosTouched(here, ranges)
    scenarios.push(...hit.scenarios.map(scenario => withSpec(scenario, specs)))
    if (!skipUnmatched) unmatched.push(...hit.unmatched.map(range => ({ file: file.path, ...range })))

    if (file.changed.kind === 'new-file' || file.changed.removed.length === 0) continue
    gone.push(...(await removedScenarios({ file: file.path, ranges: file.changed.removed }, { base: diff.base, cwd: options.cwd, proven, specs })))
  }

  return {
    kind: 'touched',
    report: {
      base: diff.base,
      scenarios: scenarios.sort(byFileThenLine),
      unmatched: unmatched.sort(byFileThenLine),
      gone: gone.sort(byIdentity),
    },
  }
}

/** Every line of a file git has never seen: there is no base version to compare it against. */
const WHOLE_FILE: LineRange = { from: 1, to: Number.MAX_SAFE_INTEGER }

/**
 * The scenarios the deleted lines used to prove and nothing proves now. The base revision is
 * the only record of them, so the old file is read back and scanned; a scenario that merely
 * moved is still proven somewhere and is not reported gone.
 */
async function removedScenarios(
  deleted: { readonly file: string; readonly ranges: readonly LineRange[] },
  against: {
    readonly base: string
    readonly cwd: string
    readonly proven: ReadonlySet<string>
    readonly specs: SpecLocations
  },
): Promise<GoneScenario[]> {
  const before = await readFileAt({ cwd: against.cwd, rev: against.base, path: deleted.file })
  if (before === undefined) return []
  const was = scanSource(before, { file: deleted.file }).sites
  return scenariosTouched(was, deleted.ranges)
    .scenarios.filter(scenario => !against.proven.has(identityKey(scenario)))
    .map(scenario => ({
      capability: scenario.capability,
      requirement: scenario.requirement,
      scenario: scenario.scenario,
      file: scenario.file,
      spec: specFor(scenario, against.specs),
    }))
}

/** Where each capability's requirements are written, by capability name. */
type SpecLocations = ReadonlyMap<string, { readonly file: string; readonly lines: ReadonlyMap<string, number> }>

function specLocations(specs: readonly SpecFileRead[]): SpecLocations {
  return new Map(
    specs.map(spec => [spec.capability, { file: spec.path, lines: requirementLines(spec.source) }]),
  )
}

function withSpec(scenario: TouchedScenario, specs: SpecLocations): TouchedScenarioReport {
  return { ...scenario, spec: specFor(scenario, specs) }
}

function specFor(
  identity: { readonly capability: string; readonly requirement: string },
  specs: SpecLocations,
): SpecLocation | undefined {
  const spec = specs.get(identity.capability)
  const line = spec?.lines.get(identity.requirement)
  if (spec === undefined || line === undefined) return undefined
  return { file: spec.file, line }
}

/** A site whose file declares a capability, narrowed so its identity can be keyed. */
function hasCapability(site: ProofSite): site is ProofSite & { capability: string } {
  return site.capability !== undefined
}

function byFileThenLine(a: { file: string; from: number }, b: { file: string; from: number }): number {
  return compareStrings(a.file, b.file) || a.from - b.from
}

function byIdentity(a: GoneScenario, b: GoneScenario): number {
  return (
    compareStrings(a.capability, b.capability) ||
    compareStrings(a.requirement, b.requirement) ||
    compareStrings(a.scenario, b.scenario)
  )
}

/** Names the first thing the scan could not read, so the reason points at a place to look. */
function reasonFor(errors: readonly ScanError[], command: 'write' | 'render' | 'touched'): string {
  const first = errors[0]!
  const rest = errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''
  return `cannot ${command}: ${first.file}:${first.line} ${first.message}${rest}`
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
