import { createHash } from 'node:crypto'
import type { GoneProof, JudgedScenario } from './types.ts'

/**
 * The keys a judgement is filed under and a requirement is asked for by.
 *
 * A judgement's key is a digest of what was judged, which is what makes a stale review
 * impossible to have rather than something to detect: change the claim, the proof or the
 * standard, and the scenario simply is not the key its review was filed under, so it comes
 * back as unjudged with no expiry rule anywhere to get wrong.
 */

/**
 * How much of the digest is kept. 48 bits: short enough to read in a list and type on a
 * command line, wide enough that a repository would need millions of judgements before two
 * of them landed on the same key.
 */
const KEY_LENGTH = 12

export function scenarioKey(scenario: JudgedScenario): string {
  return digest([
    'scenario',
    scenario.capability,
    scenario.requirement,
    scenario.scenario,
    // The standard the claim is judged against. A reworded SHALL is a different standard, so
    // every judgement made under the old one is worth taking again.
    scenario.description ?? null,
    // Keyword and text, never the line a step sits on: a blank line inserted above the test
    // moved nothing anyone judged, and keying on position would empty the ledger on a
    // formatting change.
    scenario.claim.map(step => [step.keyword, step.text]),
    scenario.proof.map(run => run.source),
  ])
}

export function goneKey(gone: GoneProof): string {
  // Its name and nothing else. The content is gone, so the only question left — was this
  // promise meant to die — is answered once, and there is nothing that could move to make
  // the answer worth asking for again.
  return digest(['gone', gone.capability, gone.requirement, gone.scenario])
}

export function requirementKey(identity: { capability: string; requirement: string }): string {
  // An address, not a judgement. It takes nothing from the description, so rewording the
  // standard partway through a review cannot move the address out from under the reviewer.
  return digest(['requirement', identity.capability, identity.requirement])
}

/**
 * The digest of a value. JSON rather than a joined string because a title may hold any
 * character, so no separator is safe — the same reason `spec-tree` keys an identity that way.
 * Each caller opens its value with a word naming what kind of key it is, which keeps the three
 * key spaces apart: a scenario and the requirement above it can never land on the same key.
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, KEY_LENGTH)
}
