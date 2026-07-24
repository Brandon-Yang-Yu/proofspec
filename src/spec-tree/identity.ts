import type { ScenarioIdentity } from './types.ts'

/**
 * A map key for a scenario's identity, shared by the tree build and the tree diff so the
 * two group scenarios the same way — two keys would let the tree and the comparison drift.
 *
 * JSON, not a joined-string separator: a title may hold any character, so no separator is
 * safe, whereas JSON encoding is unambiguous.
 */
export function identityKey(identity: ScenarioIdentity): string {
  return JSON.stringify([identity.capability, identity.requirement, identity.scenario])
}
