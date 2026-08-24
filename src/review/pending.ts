import type { ScenarioIdentity } from '../spec-tree/index.ts'
import { goneKey, scenarioKey } from './digest.ts'
import { standingReviews } from './ledger.ts'
import type { GoneProof, JudgedScenario, PendingPromise, ReviewEntry } from './types.ts'

/**
 * What a change reached that nothing has judged. This is the gate's whole question, and the
 * answer is a lookup rather than a comparison: a key is a digest of what was judged, so a
 * review that went stale is not a review under a wrong key — it is no review at all.
 */
export function pendingPromises(reached: {
  readonly scenarios: readonly JudgedScenario[]
  readonly gone: readonly GoneProof[]
  readonly entries: readonly ReviewEntry[]
}): readonly PendingPromise[] {
  const standing = standingReviews(reached.entries)
  const promises: readonly PendingPromise[] = [
    ...reached.scenarios.map(scenario => asPending(scenario, { key: scenarioKey(scenario), kind: 'touched' })),
    ...reached.gone.map(gone => asPending(gone, { key: goneKey(gone), kind: 'gone' })),
  ]
  // Judged, not judged *well*: a reported gap or drift settles its promise the same as a pass
  // does. A reviewer who cannot report a problem without blocking their own branch has a
  // reason to write a pass instead, and the gate would then be measuring their willingness to
  // let themselves through rather than what they actually found.
  return promises.filter(promise => !standing.has(promise.key))
}

function asPending(
  promise: ScenarioIdentity,
  filed: { readonly key: string; readonly kind: PendingPromise['kind'] },
): PendingPromise {
  return {
    key: filed.key,
    capability: promise.capability,
    requirement: promise.requirement,
    scenario: promise.scenario,
    kind: filed.kind,
  }
}
