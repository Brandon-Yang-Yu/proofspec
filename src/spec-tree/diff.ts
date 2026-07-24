import { identityKey } from './identity.ts'
import { compareStrings } from './order.ts'
import type { ScenarioIdentity, SpecTree, TreeChange, TreeDiff } from './types.ts'

/**
 * Says how a regenerated tree differs from a committed one — the comparison `guard` fails
 * the build on. It compares by meaning, not by text: order is not a difference, and a
 * scenario the tree does not hold (a line, a step) cannot be one either.
 */
export function diffTree(trees: { committed: SpecTree; regenerated: SpecTree }): TreeDiff {
  const before = locationsByIdentity(trees.committed)
  const after = locationsByIdentity(trees.regenerated)
  const identities = [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings)

  const changes: TreeChange[] = []
  for (const identity of identities) {
    const change = classify(before.get(identity), after.get(identity))
    if (change !== undefined) changes.push(change)
  }
  return { changes }
}

/** A scenario's identity and where it is proven. */
type Location = ScenarioIdentity & { readonly file: string }

/**
 * A scenario is present in both trees, only the committed one, or only the regenerated
 * one — the three cases of a diff. A rename is not among them: the title is the identity,
 * so a changed title is one gone and one arrived.
 */
function classify(before: Location | undefined, after: Location | undefined): TreeChange | undefined {
  if (before === undefined && after !== undefined) {
    return { kind: 'added', ...identityOf(after), file: after.file }
  }
  if (before !== undefined && after === undefined) {
    return { kind: 'removed', ...identityOf(before), file: before.file }
  }
  if (before !== undefined && after !== undefined && before.file !== after.file) {
    return { kind: 'moved', ...identityOf(before), from: before.file, to: after.file }
  }
  return undefined
}

function identityOf(location: Location): ScenarioIdentity {
  return {
    capability: location.capability,
    requirement: location.requirement,
    scenario: location.scenario,
  }
}

function locationsByIdentity(tree: SpecTree): Map<string, Location> {
  const byIdentity = new Map<string, Location>()
  for (const capability of tree.capabilities) {
    for (const requirement of capability.requirements) {
      for (const scenario of requirement.scenarios) {
        const location: Location = {
          capability: capability.capability,
          requirement: requirement.requirement,
          scenario: scenario.scenario,
          file: scenario.file,
        }
        byIdentity.set(identityKey(location), location)
      }
    }
  }
  return byIdentity
}
