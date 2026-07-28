import { comparePlacements, identityKey } from '../spec-tree/index.ts'
import type {
  CapabilityNode,
  RequirementNode,
  ScenarioIdentity,
  SpecTree,
} from '../spec-tree/index.ts'
import type { ProofSite } from '../test-scan/index.ts'
import type {
  Location,
  PositionedCapability,
  PositionedRequirement,
  PositionedScenario,
  PositionedTree,
} from './types.ts'

/**
 * Where a scenario is right now, read from the proof sites as they stand. The line is
 * whatever the site carries this moment, so inserting lines above a test moves the answer
 * with nothing to regenerate.
 *
 * A scenario no site proves is `missing`, naming what was looked for rather than the
 * nearest title: a confident wrong location costs more than no location.
 */
export function locate(sites: readonly ProofSite[], identity: ScenarioIdentity): Location {
  const position = firstSiteByIdentity(sites).get(identityKey(identity))
  if (position === undefined) return { kind: 'missing', identity }
  return { kind: 'found', file: position.file, line: position.line }
}

/**
 * The stable tree with each scenario's current position attached. `spec-tree` decides the
 * grouping and the order; locate only adds the live line, so that rule stays in one place.
 * The tree was built from these same sites, so every scenario resolves to one.
 */
export function locateTree(tree: SpecTree, sites: readonly ProofSite[]): PositionedTree {
  const positions = firstSiteByIdentity(sites)
  return { capabilities: tree.capabilities.map(capability => positionedCapability(capability, positions)) }
}

function positionedCapability(node: CapabilityNode, positions: SitesByIdentity): PositionedCapability {
  const requirements = node.requirements.map(requirement =>
    positionedRequirement(node.capability, requirement, positions),
  )
  return { capability: node.capability, requirements }
}

function positionedRequirement(
  capability: string,
  node: RequirementNode,
  positions: SitesByIdentity,
): PositionedRequirement {
  const scenarios = node.scenarios.map(scenario =>
    positionedScenario({ capability, requirement: node.requirement, scenario: scenario.scenario }, positions),
  )
  return { requirement: node.requirement, scenarios }
}

function positionedScenario(identity: ScenarioIdentity, positions: SitesByIdentity): PositionedScenario {
  // Built from these sites, so the lookup always hits — the same invariant `guard` relies on.
  const position = positions.get(identityKey(identity))!
  return { scenario: identity.scenario, file: position.file, line: position.line }
}

// --- resolving live positions from the sites ---------------------------------

/** Each scenario's proof site, keyed by identity. */
type SitesByIdentity = ReadonlyMap<string, ProofSite>

/**
 * On a collision — one identity proven at more than one site — the first site by file then
 * line wins, via the same comparator `spec-tree` and `guard` use, so the position locate
 * reports and the file the tree records name the same site. Shared with the document render,
 * which needs the whole site for its Gherkin steps, not only the placement.
 */
export function firstSiteByIdentity(sites: readonly ProofSite[]): SitesByIdentity {
  const byIdentity = new Map<string, ProofSite>()
  for (const site of sites) {
    if (site.capability === undefined) continue
    const key = identityKey({ capability: site.capability, requirement: site.requirement, scenario: site.scenario })
    const held = byIdentity.get(key)
    if (held === undefined || comparePlacements(site, held) < 0) byIdentity.set(key, site)
  }
  return byIdentity
}
