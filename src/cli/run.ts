import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { guard } from '../guard/index.ts'
import { impactTree, testsRunning } from '../impact/index.ts'
import type { GraphNode, ImpactNode, TestReach } from '../impact/index.ts'
import { renderSite, scenariosTouched } from '../locate/index.ts'
import type { LineRange, TouchedScenario } from '../locate/index.ts'
import { compareStrings } from '../order.ts'
import { readCapabilityFile, requirementLines, updateScenarioBlocks } from '../spec-file/index.ts'
import { buildTree, identityKey } from '../spec-tree/index.ts'
import type { SpecTree } from '../spec-tree/index.ts'
import { scanSource } from '../test-scan/index.ts'
import type { FileScan, ProofSite, ScanError } from '../test-scan/index.ts'
import { readChangedFiles, readFileAt } from './diff.ts'
import { readTestRuns } from './coverage.ts'
import { readCallGraph } from './graph.ts'
import { readSpecFiles, readTestFiles } from './discover.ts'
import type { SourceFile, SpecFileRead } from './discover.ts'
import type {
  GoneScenario,
  Outcome,
  ProvenRequirement,
  RunOptions,
  SpecLocation,
  TestProves,
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

  const diff = await readChangedFiles({
    cwd: options.cwd,
    paths: [options.testsDir ?? DEFAULT_TESTS_DIR],
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

/**
 * The tree from the source this change edited to the promises it reaches: the changed
 * functions, everything that calls them, the tests that get there, and what those tests
 * prove. `touched` answers the same question from the other end, starting at a changed test.
 *
 * The call graph is not proofspec's to build, so it comes from the codebase-memory index, or
 * from a file when one is named. Being unable to read it is a `cannot-run`, not an empty
 * tree: "nothing reaches this change" and "I could not look" must not read the same.
 */
export async function impact(options: RunOptions): Promise<Outcome> {
  const inputs = await gather(options)
  if (!inputs.ok) return { kind: 'cannot-run', reason: inputs.reason }

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  const unreadable = scans.flatMap(scan => scan.errors)
  if (unreadable.length > 0) return { kind: 'cannot-run', reason: reasonFor(unreadable, 'impact') }

  const testsDir = options.testsDir ?? DEFAULT_TESTS_DIR
  const diff = await readChangedFiles({
    cwd: options.cwd,
    // Everything but the tests: a changed test is `touched`'s question, not this one's.
    paths: ['.', `:(exclude)${testsDir}`],
    since: options.since,
  })
  if (!diff.ok) return { kind: 'cannot-run', reason: diff.reason }

  const graph = await readCallGraph({
    cwd: options.cwd,
    testsDir,
    project: options.project,
    from: options.graph,
  })
  if (!graph.ok) return { kind: 'cannot-run', reason: graph.reason }

  const tree = impactTree({
    changed: diff.files.map(file => ({
      file: file.path,
      ranges: file.changed.kind === 'new-file' ? [WHOLE_FILE] : file.changed.ranges,
    })),
    graph: graph.graph,
    depth: options.depth ?? DEFAULT_DEPTH,
  })

  const specs = specLocations(inputs.specs)
  if (options.coverage === undefined) {
    return {
      kind: 'impact',
      report: {
        base: diff.base,
        changed: tree.changed,
        unmapped: tree.unmapped,
        proves: provenBy(testFilesOn(tree.changed), { specs, scans }),
        from: 'call-graph',
      },
    }
  }

  const runs = await readTestRuns({ cwd: options.cwd, from: options.coverage })
  if (!runs.ok) return { kind: 'cannot-run', reason: runs.reason }
  const ran = testsRunning({ functions: changedFunctions(tree.changed), runs: runs.runs })
  return {
    kind: 'impact',
    report: {
      base: diff.base,
      changed: tree.changed,
      unmapped: tree.unmapped,
      proves: provenByRun(ran, { specs, scans }),
      from: 'test-run',
    },
  }
}

/** The changed functions themselves — the roots of the tree, which is what a run is matched on. */
function changedFunctions(nodes: readonly ImpactNode[]): readonly GraphNode[] {
  return nodes.map(node => node.fn)
}

/**
 * What the tests that actually ran the change prove. A run names a test by the line it opens
 * on, and a proof site spans its whole claim and code, so the scenario is the one whose span
 * that line falls in — the same match `touched` makes, with a single line for a range.
 */
function provenByRun(
  ran: readonly TestReach[],
  from: { readonly specs: SpecLocations; readonly scans: readonly FileScan[] },
): TestProves[] {
  const byFile = new Map<string, TouchedScenario[]>()
  for (const test of ran) {
    const sites = from.scans.filter(scan => scan.file === test.file).flatMap(scan => scan.sites)
    const found = scenariosTouched(sites, [{ from: test.line, to: test.line }]).scenarios
    if (found.length === 0) continue
    byFile.set(test.file, [...(byFile.get(test.file) ?? []), ...found])
  }
  return [...byFile]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([file, scenarios]) => ({ file, requirements: groupByRequirement(scenarios, from.specs) }))
}

/** One entry per requirement, carrying the scenarios of it that ran, in the order they ran. */
function groupByRequirement(
  scenarios: readonly TouchedScenario[],
  specs: SpecLocations,
): ProvenRequirement[] {
  const byRequirement = new Map<string, ProvenRequirement>()
  for (const scenario of scenarios) {
    const identity = { capability: scenario.capability, requirement: scenario.requirement }
    const key = `${identity.capability}\u0000${identity.requirement}`
    const held = byRequirement.get(key) ?? { ...identity, spec: specFor(identity, specs), scenarios: [] }
    if (held.scenarios.includes(scenario.scenario)) continue
    byRequirement.set(key, { ...held, scenarios: [...held.scenarios, scenario.scenario] })
  }
  return [...byRequirement.values()]
}

/** How far up the call chain the walk goes unless a run says otherwise. */
const DEFAULT_DEPTH = 4

/** Every test file the tree names, in name order, each once however often it appears. */
function testFilesOn(nodes: readonly ImpactNode[]): readonly string[] {
  const files = new Set<string>()
  const visit = (node: ImpactNode): void => {
    if (node.kind !== 'reached') return
    for (const test of node.tests) files.add(test.file)
    for (const caller of node.callers) visit(caller)
  }
  for (const node of nodes) visit(node)
  return [...files].sort(compareStrings)
}

/**
 * What each of those test files proves, grouped by requirement. The graph reaches a test
 * file, not a scenario inside it — one file's tests all call the same entry point — so the
 * unit of review is the file, and every promise it proves is listed under it.
 */
function provenBy(
  files: readonly string[],
  from: { readonly specs: SpecLocations; readonly scans: readonly FileScan[] },
): TestProves[] {
  return files.map(file => {
    const sites = from.scans.filter(scan => scan.file === file).flatMap(scan => scan.sites)
    const byRequirement = new Map<string, ProvenRequirement>()
    for (const site of sites) {
      const capability = site.capability
      // A file that declares no capability proves nothing this report can name; `check`
      // reports that gap on its own.
      if (capability === undefined) continue
      const identity = { capability, requirement: site.requirement }
      const key = `${capability}\u0000${site.requirement}`
      const held = byRequirement.get(key) ?? {
        ...identity,
        spec: specFor(identity, from.specs),
        scenarios: [],
      }
      byRequirement.set(key, { ...held, scenarios: [...held.scenarios, site.scenario] })
    }
    return { file, requirements: [...byRequirement.values()] }
  })
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
function reasonFor(errors: readonly ScanError[], command: 'write' | 'render' | 'touched' | 'impact'): string {
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
