import { compareStrings } from '../order.ts'
import type { ProofSite } from '../test-scan/index.ts'
import type { LineRange, TouchedScenario, TouchedScenarios } from './types.ts'

/**
 * The inverse of asking where a scenario is: given one file's proof sites and a set of its
 * lines, which scenarios did those lines touch, and which half of each did they move?
 *
 * A proof has two halves. The claim sits *above* the code — the Gherkin comment block comes
 * before the `it(` — and the proof is the code below it. Matching the body alone would miss
 * the change that matters most: a rewritten GIVEN/WHEN/THEN is the promise itself changing.
 *
 * One file's sites, because a line number means nothing without one: the ranges carry no file
 * of their own, so handing this two files' sites would match a line of one against a site of
 * the other.
 */
export function scenariosTouched(
  sites: readonly ProofSite[],
  ranges: readonly LineRange[],
): TouchedScenarios {
  const scenarios: TouchedScenario[] = []
  const matched = new Set<LineRange>()

  for (const site of sites) {
    // A site whose file declares no capability cannot be pointed at a requirement. `guard`
    // reports that gap; here it simply proves nothing, so its lines fall through as unmatched.
    if (site.capability === undefined) continue
    const halves = halvesOf(site, sites)
    const claimHits = ranges.filter(range => reaches(range, halves.claim))
    const proofHits = ranges.filter(range => reaches(range, halves.proof))
    const changed = moved({ claim: claimHits, proof: proofHits })
    if (changed === undefined) continue

    for (const hit of [...claimHits, ...proofHits]) matched.add(hit)
    scenarios.push({
      capability: site.capability,
      requirement: site.requirement,
      scenario: site.scenario,
      file: site.file,
      from: site.tagLine,
      to: site.endLine,
      changed,
    })
  }

  return {
    scenarios: scenarios.sort(compareTouched),
    unmatched: ranges.filter(range => !matched.has(range)),
  }
}

/** The runs of lines a site owns, split into the promise and the evidence. */
type Halves = {
  readonly claim: readonly LineRange[]
  readonly proof: readonly LineRange[]
}

/**
 * Which lines are this site's, and which half each run belongs to.
 *
 * A site tagged above its test owns one run of each: its tag block is the claim, its body the
 * proof. A site tagged inside a body owns two of each, because it shares a prelude with the
 * siblings in that test — and shares it in both directions. The GIVEN/WHEN above the `it(` is
 * part of every sentence written under it, so it is every block's *claim*; the setup between
 * the `it(` and the first block is part of how every one of them is proven, so it is every
 * block's *proof*. What a block writes between its own tag and the next one is nobody else's,
 * which is what stops one block's edit from being reported against its siblings.
 *
 * A site whose test opens on the very line it tags is the first kind: only a block sits below
 * an `it(` of its own, so that is what tells the two apart.
 */
function halvesOf(site: ProofSite, fileSites: readonly ProofSite[]): Halves {
  const ownClaim: LineRange = { from: site.tagLine, to: site.line - 1 }
  if (site.testLine === site.line) {
    return { claim: [ownClaim], proof: [{ from: site.line, to: site.endLine }] }
  }

  // `site.tagLine` seeds the list so that the prelude stays bounded by this site even if the
  // caller passed sites this one is not among.
  const tags = [site.tagLine, ...fileSites.filter(other => other.testLine === site.testLine).map(other => other.tagLine)]
  const below = tags.filter(tag => tag > site.tagLine)
  // A block runs to the line before the next block's claim opens, so the blank line between
  // two blocks belongs to the one above it rather than falling through as unmatched.
  const endsAt = below.length === 0 ? site.endLine : Math.min(...below) - 1
  const ownProof: LineRange = { from: site.line, to: endsAt }
  const sharedProof: LineRange = { from: site.testLine, to: Math.min(...tags) - 1 }

  const proof = [sharedProof, ownProof]
  const shared = site.steps.filter(step => step.line < site.tagLine).map(step => step.line)
  if (shared.length === 0) return { claim: [ownClaim], proof }

  // From the first shared step down to the `it(`: a run rather than the step lines themselves,
  // so a step wrapped onto a second line is claim all the way down.
  const sharedClaim: LineRange = { from: Math.min(...shared), to: site.testLine - 1 }
  return { claim: [sharedClaim, ownClaim], proof }
}

/**
 * Which half a change moved, or `undefined` when it reached neither and the site is no part of
 * the answer. `both` is an answer of its own, not two flags to read together.
 */
function moved(hits: {
  readonly claim: readonly LineRange[]
  readonly proof: readonly LineRange[]
}): TouchedScenario['changed'] | undefined {
  if (hits.claim.length > 0 && hits.proof.length > 0) return 'both'
  if (hits.claim.length > 0) return 'claim'
  if (hits.proof.length > 0) return 'proof'
  return undefined
}

/**
 * Whether a changed run of lines reaches any of the runs a site owns. A zone owns nothing when
 * its end precedes its start — a site with no claim written above its code collapses that way —
 * and a zone owning nothing must not catch the change that straddles the line it collapsed to.
 */
function reaches(range: LineRange, zones: readonly LineRange[]): boolean {
  return zones.some(zone => zone.from <= zone.to && zone.from <= range.to && zone.to >= range.from)
}

/** Source order within a file, and by scenario when two proofs start on the same line. */
function compareTouched(a: TouchedScenario, b: TouchedScenario): number {
  return a.from - b.from || compareStrings(a.scenario, b.scenario)
}
