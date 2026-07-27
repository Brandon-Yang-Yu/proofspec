import { assertNever } from '../assert-never.ts'
import { compareStrings } from '../order.ts'
import { buildTree, comparePlacements, diffTree, identityKey } from '../spec-tree/index.ts'
import type {
  Collision,
  Placement,
  RequirementNode,
  ScenarioIdentity,
  SpecTree,
  TreeChange,
} from '../spec-tree/index.ts'
import type { FileScan, ProofSite, ScanError } from '../test-scan/index.ts'
import { severityOf } from './report.ts'
import type { Finding, GuardReport } from './types.ts'

/**
 * Decides whether a build can proceed. It rebuilds the tree from the tests, compares it
 * against the committed capability files, and applies the rules of `docs/design.md` §7.
 *
 * It reads no files itself: `test-scan` supplies the scans, `spec-file` the committed tree.
 * Deciding is the only thing that happens here.
 */
export function guard({
  scans,
  committed,
}: {
  readonly scans: readonly FileScan[]
  readonly committed: SpecTree
}): GuardReport {
  const sites = scans.flatMap(scan => scan.sites)
  const errors = scans.flatMap(scan => scan.errors)
  const { tree, collisions, unplaced } = buildTree(sites)
  const trees = { committed, regenerated: tree }
  const declared = declaredRequirements(committed)

  const findings = [
    ...driftFindings(trees, declared, sites),
    ...unknownRequirementFindings(sites, declared),
    ...uncoveredRequirementFindings(trees),
    ...duplicateRequirementFindings(committed),
    ...collisionFindings(collisions),
    ...unplacedFindings(unplaced),
    ...missingStepFindings(sites),
    ...unreadableFindings(errors),
  ].sort(compareFindings)

  const hasFailure = findings.some(finding => severityOf(finding) === 'fail')
  return { status: hasFailure ? 'fail' : 'pass', findings }
}

/** The two trees every comparison here is between, named so neither can be taken for the other. */
type Trees = {
  readonly committed: SpecTree
  readonly regenerated: SpecTree
}

/** The requirements each committed capability file declares, by capability name. */
type DeclaredRequirements = ReadonlyMap<string, ReadonlySet<string>>

function declaredRequirements(committed: SpecTree): DeclaredRequirements {
  const byCapability = new Map<string, ReadonlySet<string>>()
  for (const capability of committed.capabilities) {
    byCapability.set(
      capability.capability,
      new Set(capability.requirements.map(requirement => requirement.requirement)),
    )
  }
  return byCapability
}

/** Whether a capability has a committed file at all. Without one there is nothing to check against. */
function hasCommittedFile(declared: DeclaredRequirements, capability: string): boolean {
  return declared.has(capability)
}

function declaresRequirement(
  declared: DeclaredRequirements,
  capability: string,
  requirement: string,
): boolean {
  return declared.get(capability)?.has(requirement) ?? false
}

// --- the tree comparison -----------------------------------------------------

/**
 * The comparison the guard exists for. Capabilities with no committed file are dropped from
 * the regenerated tree first, so their scenarios do not all read as added: those tags are
 * unresolved rather than wrong, which is what lets a suite adopt ProofSpec one capability at
 * a time.
 */
function driftFindings(
  { committed, regenerated }: Trees,
  declared: DeclaredRequirements,
  sites: readonly ProofSite[],
): Finding[] {
  const withACommittedFile: SpecTree = {
    capabilities: regenerated.capabilities.filter(node => hasCommittedFile(declared, node.capability)),
  }
  const { changes } = diffTree({ committed, regenerated: withACommittedFile })
  const placements = placementsByIdentity(sites)
  return changes.map(change => driftFinding(change, placements))
}

function driftFinding(change: TreeChange, placements: Placements): Finding {
  const identity = {
    capability: change.capability,
    requirement: change.requirement,
    scenario: change.scenario,
  }
  switch (change.kind) {
    case 'added': {
      const site = placementOf(identity, placements)
      return { kind: 'scenario-added', ...identity, file: site.file, line: site.line }
    }
    // Nothing proves it any more, so there is no site to name: the file it was recorded
    // against is the whole of what the reader has to go on.
    case 'removed':
      return { kind: 'scenario-removed', ...identity, file: change.file }
    case 'moved': {
      const site = placementOf(identity, placements)
      return { kind: 'scenario-moved', ...identity, from: change.from, to: change.to, line: site.line }
    }
    default:
      return assertNever(change)
  }
}

/** Where each scenario the tests prove sits, so a difference can point at the site itself. */
type Placements = ReadonlyMap<string, Placement>

function placementsByIdentity(sites: readonly ProofSite[]): Placements {
  const byIdentity = new Map<string, Placement>()
  for (const site of sites) {
    if (site.capability === undefined) continue
    const key = identityKey({
      capability: site.capability,
      requirement: site.requirement,
      scenario: site.scenario,
    })
    const placement = { file: site.file, line: site.line }
    const held = byIdentity.get(key)
    if (held === undefined || comparePlacements(placement, held) < 0) byIdentity.set(key, placement)
  }
  return byIdentity
}

/**
 * The regenerated tree was built from these very sites, so a scenario the comparison calls
 * added or moved always has one.
 */
function placementOf(identity: ScenarioIdentity, placements: Placements): Placement {
  return placements.get(identityKey(identity))!
}

// --- the requirement rules ---------------------------------------------------

/**
 * A tag has to name a requirement its capability file declares. A tag whose capability has
 * no file at all is left alone — the mirror case of the rule below.
 */
function unknownRequirementFindings(
  sites: readonly ProofSite[],
  declared: DeclaredRequirements,
): Finding[] {
  const findings: Finding[] = []
  for (const site of sites) {
    if (site.capability === undefined) continue
    if (!hasCommittedFile(declared, site.capability)) continue
    if (declaresRequirement(declared, site.capability, site.requirement)) continue
    findings.push({
      kind: 'unknown-requirement',
      capability: site.capability,
      requirement: site.requirement,
      scenario: site.scenario,
      file: site.file,
      line: site.line,
    })
  }
  return findings
}

/**
 * A declared requirement needs something proving it — but only once at least one test tags
 * its capability. A capability nothing tags yet is planned, not built, and ProofSpec's own
 * workflow authors the spec before the tests that prove it.
 */
function uncoveredRequirementFindings({ committed, regenerated }: Trees): Finding[] {
  const findings: Finding[] = []
  for (const capability of committed.capabilities) {
    const coverage = coverageOf(regenerated, capability.capability)
    if (coverage.kind === 'untagged') continue
    // A requirement declared twice and proven by nothing is one uncovered requirement, not
    // two: the repeated heading is its own warning, and doubling the failure here would
    // fail the build twice for a single cause.
    const reported = new Set<string>()
    for (const requirement of capability.requirements) {
      if (coverage.proven.has(requirement.requirement)) continue
      if (reported.has(requirement.requirement)) continue
      reported.add(requirement.requirement)
      findings.push({
        kind: 'uncovered-requirement',
        capability: capability.capability,
        requirement: requirement.requirement,
      })
    }
  }
  return findings
}

/**
 * Whether any test tags a capability, and if so which of its requirements they prove.
 * `untagged` is the enforcement switch, not an absence: it is what a capability looks like
 * before the first test arrives, which is a state this rule has to recognise by name.
 */
type Coverage =
  | { readonly kind: 'untagged' }
  | { readonly kind: 'tagged'; readonly proven: ReadonlySet<string> }

function coverageOf(regenerated: SpecTree, capability: string): Coverage {
  const node = regenerated.capabilities.find(candidate => candidate.capability === capability)
  if (node === undefined) return { kind: 'untagged' }
  return { kind: 'tagged', proven: new Set(node.requirements.map(requirement => requirement.requirement)) }
}

/**
 * A committed file that declares one requirement more than once. The reader does not dedup
 * headings, so every occurrence survives into the tree as a requirement node of the same
 * name; the tree keys scenarios by title, so the repeated entries collapse and nothing
 * downstream reads them wrong, which is why this warns rather than fails. One finding per
 * repeated name, however many times it was written.
 */
function duplicateRequirementFindings(committed: SpecTree): Finding[] {
  return committed.capabilities.flatMap(capability =>
    repeatedNames(capability.requirements).map((requirement): Finding => ({
      kind: 'duplicate-requirement',
      capability: capability.capability,
      requirement,
    })),
  )
}

/** The requirement names declared more than once, each returned once, in first-seen order. */
function repeatedNames(requirements: readonly RequirementNode[]): string[] {
  const counts = new Map<string, number>()
  for (const { requirement } of requirements) counts.set(requirement, (counts.get(requirement) ?? 0) + 1)
  return [...counts].flatMap(([name, count]) => (count > 1 ? [name] : []))
}

// --- the rules about the sites themselves ------------------------------------

function collisionFindings(collisions: readonly Collision[]): Finding[] {
  return collisions.map((collision): Finding => ({
    kind: 'duplicate-scenario',
    capability: collision.capability,
    requirement: collision.requirement,
    scenario: collision.scenario,
    sites: collision.sites,
  }))
}

function unplacedFindings(unplaced: readonly ProofSite[]): Finding[] {
  return unplaced.map((site): Finding => ({
    kind: 'no-capability',
    requirement: site.requirement,
    scenario: site.scenario,
    file: site.file,
    line: site.line,
  }))
}

/**
 * Every tagged site with no Gherkin above it, whether or not the tree could place it: the
 * warning is about co-location, which is a property of the site itself.
 */
function missingStepFindings(sites: readonly ProofSite[]): Finding[] {
  const stepless = sites.filter(site => site.steps.length === 0)
  return stepless.map((site): Finding => ({
    kind: 'no-steps',
    requirement: site.requirement,
    scenario: site.scenario,
    file: site.file,
    line: site.line,
  }))
}

/** The scan reports what it could not read; deciding the build cannot proceed happens here. */
function unreadableFindings(errors: readonly ScanError[]): Finding[] {
  return errors.map((error): Finding => ({
    kind: 'unreadable',
    reason: error.kind,
    message: error.message,
    file: error.file,
    line: error.line,
  }))
}

// --- the order they are reported in ------------------------------------------

/**
 * Findings the reader can open a file on come first, the tree comparison after them, and
 * the warnings last. A `Record` and not a list, so adding a kind without ranking it is a
 * compile error rather than a kind that silently sorts first.
 */
const KIND_ORDER: Record<Finding['kind'], number> = {
  unreadable: 0,
  'no-capability': 1,
  'duplicate-scenario': 2,
  'unknown-requirement': 3,
  'uncovered-requirement': 4,
  'scenario-added': 5,
  'scenario-removed': 6,
  'scenario-moved': 7,
  'no-steps': 8,
  'duplicate-requirement': 9,
}

function compareFindings(a: Finding, b: Finding): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  return byKind !== 0 ? byKind : compareParts(orderParts(a), orderParts(b))
}

/** What orders two findings of one kind, most significant part first. */
type OrderParts = readonly (string | number)[]

/**
 * Written out per kind rather than by stringifying the whole finding, so the report's order
 * cannot shift when a field is added to one of the shapes above or written in another
 * order. Same reason `spec-tree` names the fields of its identity key explicitly.
 */
function orderParts(finding: Finding): OrderParts {
  switch (finding.kind) {
    case 'scenario-removed':
      return [finding.capability, finding.requirement, finding.scenario, finding.file]
    case 'scenario-added':
    case 'unknown-requirement':
      return [finding.capability, finding.requirement, finding.scenario, finding.file, finding.line]
    case 'scenario-moved':
      return [finding.capability, finding.requirement, finding.scenario, finding.from, finding.to, finding.line]
    case 'uncovered-requirement':
    case 'duplicate-requirement':
      return [finding.capability, finding.requirement]
    case 'duplicate-scenario':
      return [finding.capability, finding.requirement, finding.scenario]
    case 'no-capability':
    case 'no-steps':
      return [finding.requirement, finding.scenario, finding.file, finding.line]
    case 'unreadable':
      return [finding.file, finding.line, finding.reason]
    default:
      return assertNever(finding)
  }
}

/**
 * Walks two findings of one kind in step — they always yield parts of the same shape, so a
 * missing part means the shapes went out of step and there is nothing left to compare.
 * Numbers compare as numbers, so line 9 comes before line 10.
 */
function compareParts(a: OrderParts, b: OrderParts): number {
  for (const [index, part] of a.entries()) {
    const other = b[index]
    if (other === undefined) break
    const difference =
      typeof part === 'number' && typeof other === 'number'
        ? part - other
        : compareStrings(String(part), String(other))
    if (difference !== 0) return difference
  }
  return 0
}
