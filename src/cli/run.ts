import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { changedTerms, definitionsFor, reopenedByTerms, standardTexts } from '../glossary/index.ts'
import type { ReopenedPromise, TermChange } from '../glossary/index.ts'
import { guard } from '../guard/index.ts'
import { impactTree, testsRunning } from '../impact/index.ts'
import type { GraphNode, ImpactNode, TestReach } from '../impact/index.ts'
import { renderSite, scenariosTouched } from '../locate/index.ts'
import type { LineRange, TouchedScenario } from '../locate/index.ts'
import { compareStrings } from '../order.ts'
import {
  goneKey,
  isVerdict,
  pendingPromises,
  recordReview,
  requirementKey,
  REVIEW_PROTOCOL,
  scenarioKey,
  standingReviews,
  VERDICTS,
} from '../review/index.ts'
import type { JudgedPromise, JudgedScenario, ProvingLines, ReviewEntry } from '../review/index.ts'
import { readCapabilityFile, readTerms, requirementLines, updateScenarioBlocks } from '../spec-file/index.ts'
import type { CapabilitySpec, TermSpec } from '../spec-file/index.ts'
import { buildTree, identityKey } from '../spec-tree/index.ts'
import type { SpecTree } from '../spec-tree/index.ts'
import { scanSource } from '../test-scan/index.ts'
import type { FileScan, ProofSite, ScanError, Step } from '../test-scan/index.ts'
import { readChangedFiles, readFileAt } from './diff.ts'
import type { ChangedFile } from './diff.ts'
import { readTestRuns } from './coverage.ts'
import { readCallGraph } from './graph.ts'
import { readSpecFiles, readTestFiles } from './discover.ts'
import type { SourceFile, SpecFileRead } from './discover.ts'
import { appendReview, readReviews } from './reviews.ts'
import type {
  DistributiveOmit,
  GoneScenario,
  Outcome,
  ProvenRequirement,
  RequirementDeclaration,
  RunOptions,
  SpecLocation,
  StandingReview,
  TestProves,
  TouchedScenarioReport,
  TouchedSummary,
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
  const specs = inputs.specs.map(file => readCapabilityFile(file.source, { capability: file.capability }))
  const committed: SpecTree = { capabilities: specs }
  return {
    kind: 'checked',
    report: guard({ scans, committed, terms: specs.flatMap(spec => spec.terms) }),
  }
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
 * Names what the changes since a base revision touched, in the shape it was asked for: the
 * work list, one requirement in full, or the changed lines no promise owns. It is the inverse
 * of the check — not "do the tests and the files agree", but "what promises did this branch
 * put its hands on, and has anybody looked at them".
 *
 * It still reports rather than judging what it finds: `gone` names a promise nothing proves
 * any more and this does not fail on it, because that verdict is the check's to give. What the
 * work list does hold is a gate on the *reviewing* — whether every promise reached has been
 * looked at, which is a fact about this branch's process and not about its code.
 */
export async function touched(options: RunOptions): Promise<Outcome> {
  const reached = await reachedBy(options)
  if (!reached.ok) return { kind: 'cannot-run', reason: reached.reason }

  const ask = options.ask ?? { kind: 'summary' }
  if (ask.kind === 'summary') return { kind: 'touched', report: workList(reached) }
  if (ask.kind === 'unmatched') {
    return { kind: 'touched', report: { kind: 'unmatched', base: reached.base, lines: reached.unmatched } }
  }

  const found = reached.requirements.find(one => one.key === ask.key)
  // Cannot-run rather than an empty requirement. An address that matches nothing is what a
  // stale key looks like, and handing it back as "nothing to judge here" is how a reviewer
  // works through a list and reviews none of it.
  if (found === undefined) {
    return { kind: 'cannot-run', reason: `cannot touched: no requirement this change reached is at ${ask.key}` }
  }
  return { kind: 'touched', report: { kind: 'requirement', base: reached.base, ...found, review: REVIEW_PROTOCOL } }
}

/**
 * The work list: every requirement reached, counted rather than written out.
 *
 * What is still unjudged is `review`'s answer rather than a filter written here. The rule that
 * a reported problem settles its promise just as a pass does is a real decision with a reason
 * behind it, and a second copy of it in this file is a second place for it to be got wrong.
 */
function workList(reached: ReachedNow): TouchedSummary {
  const promises = reached.requirements.flatMap(one => promisesIn(one, reached.vocabulary))
  const pending = new Set(
    pendingPromises({
      scenarios: promises.filter(one => one.kind === 'touched').map(one => one.scenario),
      gone: promises.filter(one => one.kind === 'gone').map(one => one.scenario),
      entries: reached.entries,
    }).map(one => one.key),
  )

  return {
    kind: 'summary',
    base: reached.base,
    requirements: reached.requirements.map(one => ({
      key: one.key,
      capability: one.capability,
      requirement: one.requirement,
      scenarios: one.scenarios.length,
      gone: one.gone.length,
      pending: [...one.scenarios, ...one.gone].filter(promise => pending.has(promise.key)).length,
    })),
    unmatched: reached.unmatched.length,
  }
}

/** Every promise one requirement holds, in the shape `review` judges them in. */
function promisesIn(group: ReachedGroup, vocabulary: readonly TermSpec[]): readonly JudgedPromise[] {
  const under = judgedUnder(group, vocabulary)
  return [
    ...group.scenarios.map(one => ({ kind: 'touched' as const, scenario: judgeable(under, one) })),
    ...group.gone.map(one => ({
      kind: 'gone' as const,
      scenario: { capability: under.capability, requirement: under.requirement, scenario: one.scenario },
    })),
  ]
}

/** What a requirement's scenarios are judged under: its identity, and the standard it sets. */
type JudgedUnder = {
  readonly capability: string
  readonly requirement: string
  readonly description: string | undefined
  /** The repo's vocabulary: the definitions a promise's standard may lean on. */
  readonly vocabulary: readonly TermSpec[]
}

function judgedUnder(
  group: {
    readonly capability: string
    readonly requirement: string
    readonly spec: RequirementDeclaration | undefined
  },
  vocabulary: readonly TermSpec[],
): JudgedUnder {
  return {
    capability: group.capability,
    requirement: group.requirement,
    description: group.spec?.description,
    vocabulary,
  }
}

/**
 * One promise as `review` judges it. The description comes from the requirement above it rather
 * than from the promise, which is why nothing can key one without the group it sits under.
 *
 * A removed proof reaches this with neither half: there is nothing of it left to weigh, which
 * is exactly why its key never moves once it has been answered.
 */
function judgeable(
  under: JudgedUnder,
  promise: { readonly scenario: string; readonly claim: readonly Step[]; readonly proof: readonly ProvingLines[] },
): JudgedScenario {
  return {
    capability: under.capability,
    requirement: under.requirement,
    scenario: promise.scenario,
    description: under.description,
    claim: promise.claim,
    proof: promise.proof,
    // The definitions of the terms this standard uses, so a redefined word moves the key.
    // The standard's texts are named once, in the glossary, because keying a promise and
    // re-opening it must read them the same way.
    definitions: definitionsFor(
      standardTexts({
        capability: under.capability,
        requirement: under.requirement,
        scenario: promise.scenario,
        description: under.description,
        claim: promise.claim,
      }),
      under.vocabulary,
    ),
  }
}

/**
 * Records one reviewer's judgement of one promise this change reached, and appends it to the
 * ledger. The promise is looked up by the key rather than taken on trust, because a pass has
 * to be checked against the lines it cites — and a key matching nothing is a review of
 * something this change did not touch, which would file a judgement nothing ever reads.
 */
export async function review(options: RunOptions): Promise<Outcome> {
  const proposed = options.review
  if (proposed === undefined) return { kind: 'cannot-run', reason: 'cannot review: no review was given' }

  // A value the tool does not know, refused before anything is read. The argument parser turns
  // flags into options; deciding what a verdict may be belongs to whoever owns verdicts.
  if (!isVerdict(proposed.verdict)) {
    return { kind: 'cannot-run', reason: `cannot review: ${proposed.verdict} is not a verdict. Use ${VERDICTS.join(', ')}.` }
  }

  const reached = await reachedBy(options)
  if (!reached.ok) return { kind: 'cannot-run', reason: reached.reason }

  const judging = judgedAt(reached, proposed.key)
  if (judging === undefined) {
    return { kind: 'cannot-run', reason: `cannot review: no promise this change reached is at ${proposed.key}` }
  }

  const recorded = recordReview({
    proposed: { ...proposed, verdict: proposed.verdict, at: new Date().toISOString() },
    promise: judging,
  })
  if (!recorded.ok) return { kind: 'cannot-run', reason: `cannot review: ${recorded.reason}` }

  await appendReview({ cwd: options.cwd, entry: recorded.entry })
  return { kind: 'reviewed', entry: recorded.entry }
}

/**
 * The promise one key names, as `review` needs it — and which of the two kinds it is, since a
 * removed proof has no lines a pass could cite and that has to be said rather than inferred.
 */
function judgedAt(reached: ReachedNow, key: string): JudgedPromise | undefined {
  for (const group of reached.requirements) {
    const identity = { capability: group.capability, requirement: group.requirement }
    const under = judgedUnder(group, reached.vocabulary)
    const touchedHere = group.scenarios.find(one => one.key === key)
    if (touchedHere !== undefined) return { kind: 'touched', scenario: judgeable(under, touchedHere) }
    const goneHere = group.gone.find(one => one.key === key)
    if (goneHere !== undefined) return { kind: 'gone', scenario: { ...identity, scenario: goneHere.scenario } }
  }
  return undefined
}

/** Everything a change reached, before it is narrowed to the answer that was asked for. */
type ReachedNow = {
  readonly ok: true
  readonly base: string
  readonly requirements: readonly ReachedGroup[]
  readonly unmatched: readonly UnmatchedLines[]
  /** The ledger as it stands, so the work list can ask `review` what is left rather than guess. */
  readonly entries: readonly ReviewEntry[]
  /** The repo's vocabulary, so every promise can be keyed with the terms its standard uses. */
  readonly vocabulary: readonly TermSpec[]
}

/** One requirement and everything under it, keyed and with any standing judgements attached. */
type ReachedGroup = {
  readonly key: string
  readonly capability: string
  readonly requirement: string
  readonly spec: RequirementDeclaration | undefined
  readonly scenarios: readonly TouchedScenarioReport[]
  readonly gone: readonly GoneScenario[]
}

async function reachedBy(options: RunOptions): Promise<ReachedNow | { readonly ok: false; readonly reason: string }> {
  const inputs = await gather(options)
  if (!inputs.ok) return inputs

  const scans = inputs.tests.map(file => scanSource(file.source, { file: file.path }))
  // A test the scan could not read may hold the very proof the change touched, so the answer
  // would be quietly incomplete — refused the way `write` and `render` refuse it.
  const unreadable = scans.flatMap(scan => scan.errors)
  if (unreadable.length > 0) return { ok: false, reason: reasonFor(unreadable, 'touched') }
  const sites = scans.flatMap(scan => scan.sites)

  const diff = await readChangedFiles({
    cwd: options.cwd,
    // Where the caller gave its tests, the diff follows them: a root outside the conventional
    // tests/ is where this branch's test changes would otherwise hide from the work list.
    paths: options.tests?.roots ?? [options.testsDir ?? DEFAULT_TESTS_DIR],
    since: options.since,
  })
  if (!diff.ok) return diff

  const ledger = await readReviews(options.cwd)
  if (!ledger.ok) return ledger

  const specReads = readSpecs(inputs.specs)
  const specs = specLocations(specReads)
  const held = new Map(inputs.tests.map(test => [test.path, test.source]))
  const read = await changedLines(diff.files, { cwd: options.cwd, held })
  if (!read.ok) return read
  const proven = new Set(sites.filter(hasCapability).map(site => identityKey(site)))
  const found = new Map<string, Gathering>()
  const unmatched: UnmatchedLines[] = []

  for (const file of diff.files) {
    const here = sites.filter(site => site.file === file.path)
    const ranges = file.changed.kind === 'new-file' ? [WHOLE_FILE] : file.changed.ranges
    // A file git has never seen has no lines to compare, so nothing in it can be unmatched:
    // the whole file is new, and every proof it holds is new with it.
    const skipUnmatched = file.changed.kind === 'new-file'

    const hit = scenariosTouched(here, ranges)
    // Split once per file rather than once per scenario. A deleted file has no lines to cut
    // from and no scenarios or unmatched runs to cut them for, so the empty fallback is never
    // reached — but it still has removed lines to account for below, so this cannot skip it.
    const lines = read.lines.get(file.path) ?? []
    for (const scenario of hit.scenarios) reached(found, scenario).scenarios.push(withSource(scenario, lines))
    if (!skipUnmatched) {
      const runs = hit.unmatched.map(range => ({ file: file.path, ...range, source: sourceOf(lines, range) }))
      unmatched.push(...runs.filter(saysSomething))
    }

    if (file.changed.kind === 'new-file' || file.changed.removed.length === 0) continue
    const removed = await removedScenarios({ file: file.path, ranges: file.changed.removed }, { base: diff.base, cwd: options.cwd, proven })
    for (const was of removed) reached(found, was).gone.push({ scenario: was.scenario, file: was.file })
  }

  // The second axis. The diff above reads the tests; this reads where the vocabulary lives,
  // against the same base, and every promise whose standard uses a changed term is reached
  // exactly as a changed test line reaches the proof that owns it.
  const vocabulary = specReads.flatMap(one => one.read.terms)
  const specDiff = await readChangedFiles({
    cwd: options.cwd,
    paths: [options.specsDir ?? DEFAULT_SPECS_DIR],
    since: options.since,
  })
  if (!specDiff.ok) return specDiff
  const changed = await changedTermsSince({
    cwd: options.cwd,
    base: specDiff.base,
    files: specDiff.files,
    now: new Map(specReads.map(one => [one.path, one.read.terms])),
  })
  const testLines = new Map(inputs.tests.map(file => [file.path, file.source.split('\n')]))
  const reopened = reopenedByTerms({
    changed,
    terms: vocabulary,
    promises: sites.filter(hasCapability).map(site => ({
      capability: site.capability,
      requirement: site.requirement,
      scenario: site.scenario,
      description: declarationFor(
        { capability: site.capability, requirement: site.requirement },
        specs,
      )?.description,
      claim: site.steps,
    })),
  })
  for (const promise of reopened) {
    reopenedInto(found, promise, { sites, testLines })
  }

  return {
    ok: true,
    base: diff.base,
    requirements: requirementsReached(found, { specs, entries: ledger.entries, vocabulary }),
    unmatched: unmatched.sort(byFileThenLine),
    entries: ledger.entries,
    vocabulary,
  }
}

/**
 * Which terms changed between the base revision and the working tree. Only the changed
 * capability files are compared — a file whose bytes did not move holds the definitions it
 * held — and a file git has never seen has no base version, so every term it defines is new.
 */
async function changedTermsSince(from: {
  readonly cwd: string
  readonly base: string
  readonly files: readonly ChangedFile[]
  readonly now: ReadonlyMap<string, readonly TermSpec[]>
}): Promise<readonly TermChange[]> {
  const before: TermSpec[] = []
  const after: TermSpec[] = []
  for (const file of from.files) {
    const was = await readFileAt({ cwd: from.cwd, rev: from.base, path: file.path })
    if (was !== undefined) before.push(...readTerms(was))
    const stands = from.now.get(file.path)
    if (stands !== undefined) after.push(...stands)
  }
  return changedTerms({ before, after })
}

/**
 * One re-opened promise, gathered under its requirement. A promise both axes reached is
 * gathered once, carrying the term changes with it — it is one promise, and one judgement
 * settles it.
 */
function reopenedInto(
  found: Map<string, Gathering>,
  promise: ReopenedPromise,
  from: {
    readonly sites: readonly ProofSite[]
    readonly testLines: ReadonlyMap<string, readonly string[]>
  },
): void {
  const group = reached(found, { capability: promise.capability, requirement: promise.requirement })
  const gathered = group.scenarios.findIndex(one => one.scenario === promise.scenario)
  if (gathered !== -1) {
    group.scenarios[gathered] = { ...group.scenarios[gathered]!, reopenedBy: promise.reopenedBy }
    return
  }

  // The proving lines, as they stand, so the reviewer judges the claim against its evidence
  // in one read. A single line at the site's own test reaches exactly its proof, the same
  // match the first axis makes — the halves are `locate`'s to name, not this file's.
  const site = from.sites.find(
    one =>
      one.capability === promise.capability &&
      one.requirement === promise.requirement &&
      one.scenario === promise.scenario,
  )
  if (site === undefined) return
  const hit = scenariosTouched(
    from.sites.filter(one => one.file === site.file),
    [{ from: site.line, to: site.line }],
  ).scenarios.find(one => one.scenario === promise.scenario)
  if (hit === undefined) return
  const lines = from.testLines.get(site.file) ?? []
  group.scenarios.push({ ...withSource(hit, lines), changed: 'term', reopenedBy: promise.reopenedBy })
}

/**
 * Whether a run of changed lines says anything at all. A run that is nothing but whitespace is
 * the blank line git hands back with the block inserted beside it: it belongs to no promise, it
 * tells a reader nothing, and there are usually more of them than there are real edits — so
 * naming them buries the helper and fixture changes `unmatched` exists to show.
 */
function saysSomething(run: UnmatchedLines): boolean {
  return run.source.trim() !== ''
}

/** Every changed file's current lines, or the reason one of them could not be read back. */
type LinesRead =
  | { readonly ok: true; readonly lines: ReadonlyMap<string, readonly string[]> }
  | { readonly ok: false; readonly reason: string }

/**
 * The lines of every changed file the report will cut source from. A test is already in hand
 * from the scan; a helper or a fixture beside it is not, and is read here, because its changed
 * lines are carried as written too.
 *
 * A file git names as changed but that cannot be read back is a cannot-run, the way an
 * unreadable test is: carrying its lines as blank would be a claim about them, and a wrong one.
 * Only the files with lines to cut are read — a deleted file has none, and reading it back
 * would refuse a run over a file the change was supposed to remove.
 */
async function changedLines(
  files: readonly ChangedFile[],
  from: { readonly cwd: string; readonly held: ReadonlyMap<string, string> },
): Promise<LinesRead> {
  const lines = new Map<string, readonly string[]>()
  for (const file of files) {
    const source = from.held.get(file.path)
    if (source !== undefined) {
      lines.set(file.path, source.split('\n'))
      continue
    }
    if (file.changed.kind === 'new-file' || file.changed.ranges.length === 0) continue
    const now = await readWorkingCopy(join(from.cwd, file.path))
    if (now === undefined) return { ok: false, reason: `cannot touched: ${file.path} could not be read` }
    lines.set(file.path, now.split('\n'))
  }
  return { ok: true, lines }
}

/** A file as it now stands, or `undefined` when it cannot be read — a miss, not a crash. */
async function readWorkingCopy(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** A touched scenario before it is keyed: the key needs the standard, which its group holds. */
type UnkeyedScenario = DistributiveOmit<TouchedScenarioReport, 'key' | 'reviewed'>

/** A removed proof before it is keyed. */
type UnkeyedGone = Omit<GoneScenario, 'key' | 'reviewed'>

/** One requirement's findings while the report is still being gathered, before they are ordered. */
type Gathering = RequirementIdentity & {
  readonly scenarios: UnkeyedScenario[]
  readonly gone: UnkeyedGone[]
}

/** The entry everything under a requirement is collected in, opened the first time one is reached. */
function reached(found: Map<string, Gathering>, identity: RequirementIdentity): Gathering {
  const key = groupKey(identity)
  const held = found.get(key) ?? {
    capability: identity.capability,
    requirement: identity.requirement,
    scenarios: [],
    gone: [],
  }
  found.set(key, held)
  return held
}

/**
 * What the change reached, by requirement, with the prose each capability file writes under it
 * and any judgement already standing against each promise.
 *
 * The order is the tree's own — capability, then requirement — rather than the diff's, so two
 * runs of the same branch are comparable; inside a requirement the scenarios keep file order,
 * which is the order a person walks a diff in.
 *
 * The keys are struck here rather than where the scenarios were collected, because a key takes
 * in the description written under the requirement, and that is a fact about the group rather
 * than about any one scenario under it.
 */
function requirementsReached(
  found: ReadonlyMap<string, Gathering>,
  read: { readonly specs: SpecLocations; readonly entries: readonly ReviewEntry[]; readonly vocabulary: readonly TermSpec[] },
): ReachedGroup[] {
  const standing = standingReviews(read.entries)
  return [...found.values()].sort(byRequirement).map(one => {
    const identity = { capability: one.capability, requirement: one.requirement }
    const spec = declarationFor(one, read.specs)
    const under = judgedUnder({ ...identity, spec }, read.vocabulary)
    return {
      // The address a reader asks for this requirement by, not the key it was gathered under:
      // one is a digest a person can type, the other a map key private to the gathering.
      key: requirementKey(identity),
      ...identity,
      spec,
      scenarios: [...one.scenarios]
        .sort(byFileThenLine)
        .map(scenario => ({ ...scenario, ...judgedBy(standing, scenarioKey(judgeable(under, scenario))) })),
      gone: [...one.gone]
        .sort((a, b) => compareStrings(a.scenario, b.scenario))
        .map(was => ({ ...was, ...judgedBy(standing, goneKey({ ...identity, scenario: was.scenario })) })),
    }
  })
}

/** A promise's key and whatever judgement stands against it, which is nothing until one is made. */
function judgedBy(
  standing: ReadonlyMap<string, ReviewEntry>,
  key: string,
): { readonly key: string; readonly reviewed: StandingReview | undefined } {
  const entry = standing.get(key)
  if (entry === undefined) return { key, reviewed: undefined }
  return { key, reviewed: { verdict: entry.verdict, by: entry.by, at: entry.at } }
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

  const specs = specLocations(readSpecs(inputs.specs))
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
    const key = groupKey(identity)
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
      const key = groupKey(identity)
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
  },
): Promise<readonly TouchedScenario[]> {
  const before = await readFileAt({ cwd: against.cwd, rev: against.base, path: deleted.file })
  if (before === undefined) return []
  const was = scanSource(before, { file: deleted.file }).sites
  return scenariosTouched(was, deleted.ranges).scenarios.filter(
    scenario => !against.proven.has(identityKey(scenario)),
  )
}

/** A requirement named by its capability and its own name — how the tree keys one. */
type RequirementIdentity = {
  readonly capability: string
  readonly requirement: string
}

/** The two names as one map key. A NUL cannot appear in either, so nothing can collide. */
/**
 * Not `requirementKey`, which is imported above. That one is a digest a person types on a
 * command line and the ledger files judgements under, so it has to stay stable and
 * content-addressed. This one only has to be unique inside one run's `Map`.
 */
function groupKey(identity: RequirementIdentity): string {
  return `${identity.capability}\u0000${identity.requirement}`
}

/** What a capability file says about one requirement: where its heading is, and the prose under it. */
type RequirementRead = {
  readonly line: number
  readonly description: string
}

/** What each capability's requirements say and where they are written, by capability name. */
type SpecLocations = ReadonlyMap<
  string,
  { readonly file: string; readonly requirements: ReadonlyMap<string, RequirementRead> }
>

/** One capability file as both halves the commands need: its bytes, and its read. */
type SpecRead = {
  readonly path: string
  readonly source: string
  readonly read: CapabilitySpec
}

/** Every capability file, read once for all its consumers. */
function readSpecs(specs: readonly SpecFileRead[]): readonly SpecRead[] {
  return specs.map(file => ({
    path: file.path,
    source: file.source,
    read: readCapabilityFile(file.source, { capability: file.capability }),
  }))
}

function specLocations(specs: readonly SpecRead[]): SpecLocations {
  return new Map(specs.map(spec => [spec.read.capability, readRequirements(spec)]))
}

/**
 * One capability file's requirements, read once for both halves the report needs. A name
 * written twice keeps the first heading — the place the requirement was declared, which is
 * where `requirementLines` sends a reader and where its prose was written; the guard is what
 * warns about the repeat.
 */
function readRequirements(spec: SpecRead): {
  readonly file: string
  readonly requirements: ReadonlyMap<string, RequirementRead>
} {
  const lines = requirementLines(spec.source)
  const requirements = new Map<string, RequirementRead>()
  for (const read of spec.read.requirements) {
    const line = lines.get(read.requirement)
    if (line === undefined || requirements.has(read.requirement)) continue
    requirements.set(read.requirement, { line, description: read.description })
  }
  return { file: spec.path, requirements }
}

/**
 * A touched scenario as the report hands it over: the lines that prove it, as they are written.
 * `locate` names those lines and stops, because it reads no files; cutting them is this
 * capability's job, since it owns the filesystem. The capability and the requirement come off
 * here — the entry this scenario is filed under carries them for every scenario at once.
 *
 * Unkeyed: a key takes in the description written under the requirement, which is not in hand
 * until the scenarios have been grouped under it.
 */
function withSource(scenario: TouchedScenario, lines: readonly string[]): UnkeyedScenario {
  const { proves, capability, requirement, ...rest } = scenario
  return { ...rest, proof: proves.map(range => ({ ...range, source: sourceOf(lines, range) })) }
}

/**
 * A run of lines as they are written. A `LineRange` counts from 1 and includes both ends;
 * `slice` counts from 0 and excludes the end, so the start moves back one and the end does not.
 */
function sourceOf(lines: readonly string[], range: LineRange): string {
  return lines.slice(range.from - 1, range.to).join('\n')
}

/** Where a requirement is written and what it says, or nothing when no capability file declares it. */
function declarationFor(
  identity: RequirementIdentity,
  specs: SpecLocations,
): RequirementDeclaration | undefined {
  const spec = specs.get(identity.capability)
  const read = spec?.requirements.get(identity.requirement)
  if (spec === undefined || read === undefined) return undefined
  return { file: spec.file, line: read.line, description: read.description }
}

/** The same lookup cut down to the position — what `impact` names, which carries no prose. */
function specFor(identity: RequirementIdentity, specs: SpecLocations): SpecLocation | undefined {
  const declared = declarationFor(identity, specs)
  if (declared === undefined) return undefined
  return { file: declared.file, line: declared.line }
}

/** A site whose file declares a capability, narrowed so its identity can be keyed. */
function hasCapability(site: ProofSite): site is ProofSite & { capability: string } {
  return site.capability !== undefined
}

function byFileThenLine(a: { file: string; from: number }, b: { file: string; from: number }): number {
  return compareStrings(a.file, b.file) || a.from - b.from
}

function byRequirement(a: RequirementIdentity, b: RequirementIdentity): number {
  return compareStrings(a.capability, b.capability) || compareStrings(a.requirement, b.requirement)
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
 * Tests given by the caller are read as they stand: a caller trusted to read its own tests
 * is trusted to have read them all.
 */
async function gather(options: RunOptions): Promise<Gathered> {
  const specs = await readSpecFiles(options.cwd, options.specsDir ?? DEFAULT_SPECS_DIR)
  if (!specs.ok) return specs
  if (options.tests !== undefined) return { ok: true, specs: specs.files, tests: options.tests.files }
  const tests = await readTestFiles(options.cwd, options.testsDir ?? DEFAULT_TESTS_DIR)
  if (!tests.ok) return tests
  return { ok: true, specs: specs.files, tests: tests.files }
}
