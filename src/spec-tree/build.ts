import type { ProofSite } from '../test-scan/index.ts'
import { identityKey } from './identity.ts'
import { compareStrings } from './order.ts'
import type {
  CapabilityNode,
  Collision,
  Placement,
  RequirementNode,
  ScenarioIdentity,
  ScenarioNode,
  SpecTree,
  TreeBuild,
} from './types.ts'

/**
 * Turns a scan's proof sites into the stable tree, alongside the collisions and the sites
 * with no capability. The tree is `guard`'s and the write-back's single source; both read
 * it rather than grouping the sites themselves, so the stable-identity rule lands once.
 */
export function buildTree(sites: readonly ProofSite[]): TreeBuild {
  const unplaced = sites.filter(site => site.capability === undefined)
  const placed = sites.filter(hasCapability)

  const groups = groupByIdentity(placed)
  return {
    tree: assembleTree(groups),
    collisions: collectCollisions(groups),
    unplaced,
  }
}

type PlacedSite = ProofSite & { readonly capability: string }

function hasCapability(site: ProofSite): site is PlacedSite {
  return site.capability !== undefined
}

// --- grouping proof sites by scenario identity -------------------------------

/**
 * The proof sites that claimed one identity. More than one is a collision; the tree still
 * carries the scenario once.
 */
type IdentityGroup = ScenarioIdentity & { readonly sites: PlacedSite[] }

function groupByIdentity(sites: readonly PlacedSite[]): IdentityGroup[] {
  const byKey = new Map<string, IdentityGroup>()
  for (const site of sites) {
    const key = identityKey(site)
    const group = byKey.get(key)
    if (group === undefined) {
      byKey.set(key, {
        capability: site.capability,
        requirement: site.requirement,
        scenario: site.scenario,
        sites: [site],
      })
    } else {
      group.sites.push(site)
    }
  }
  return [...byKey.values()]
}

// --- the tree ----------------------------------------------------------------

function assembleTree(groups: readonly IdentityGroup[]): SpecTree {
  return { capabilities: groupBy(groups, group => group.capability).map(capabilityNode) }
}

function capabilityNode([capability, groups]: [string, IdentityGroup[]]): CapabilityNode {
  return { capability, requirements: groupBy(groups, group => group.requirement).map(requirementNode) }
}

function requirementNode([requirement, groups]: [string, IdentityGroup[]]): RequirementNode {
  const scenarios = groups.map(scenarioNode).sort((a, b) => compareStrings(a.scenario, b.scenario))
  return { requirement, scenarios }
}

function scenarioNode(group: IdentityGroup): ScenarioNode {
  return { scenario: group.scenario, file: fileOf(group) }
}

/** One deterministic file for the scenario node — the first, so a collision still resolves. */
function fileOf(group: IdentityGroup): string {
  return group.sites.map(site => site.file).sort(compareStrings)[0]!
}

/** Buckets items by key and returns the buckets in key order, so every level sorts stably. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): [string, T[]][] {
  const byKey = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [item])
    else bucket.push(item)
  }
  return [...byKey.entries()].sort(([a], [b]) => compareStrings(a, b))
}

// --- collisions --------------------------------------------------------------

function collectCollisions(groups: readonly IdentityGroup[]): Collision[] {
  return groups
    .filter(group => group.sites.length > 1)
    .map((group): Collision => ({
      capability: group.capability,
      requirement: group.requirement,
      scenario: group.scenario,
      sites: sortPlacements(group.sites.map(site => ({ file: site.file, line: site.line }))),
    }))
    .sort((a, b) => compareStrings(identityKey(a), identityKey(b)))
}

function sortPlacements(placements: readonly Placement[]): Placement[] {
  return [...placements].sort((a, b) => {
    const byFile = compareStrings(a.file, b.file)
    return byFile !== 0 ? byFile : a.line - b.line
  })
}
