import type { GoneProof, JudgedScenario, ProvingLines, ReviewEntry } from '../../src/review/index.ts'
import type { Step } from '../../src/test-scan/index.ts'

/**
 * `review` reads no files and knows no language, so its fixtures are plain values: a scenario
 * as the report hands it over, and a review as the ledger keeps it. Every builder here
 * defaults every field a given test does not care about, so a test varies exactly the one
 * thing it is making a point about — which is what lets the digest tests say "only the claim
 * moved" and be believed.
 */

export const CAPABILITY = 'demo'
export const REQUIREMENT = 'A demonstrated promise'
export const SCENARIO = 'A demonstrated behavior'
export const DESCRIPTION = 'The tool SHALL demonstrate the thing it promises.'

/** The Gherkin a fixture scenario claims. */
export function claim(then = 'the demonstrated claim holds'): readonly Step[] {
  return [
    { keyword: 'GIVEN', text: 'a demonstrated arrangement', line: 10 },
    { keyword: 'THEN', text: then, line: 11 },
  ]
}

/** The one run of lines a fixture scenario is proven by. */
export function proof(source = 'expect(outcome).toBe(true)'): readonly ProvingLines[] {
  return [{ from: 20, to: 20, source }]
}

export function judged(fields: {
  readonly scenario?: string
  readonly capability?: string
  readonly requirement?: string
  readonly description?: string | undefined
  readonly claim?: readonly Step[]
  readonly proof?: readonly ProvingLines[]
} = {}): JudgedScenario {
  return {
    capability: fields.capability ?? CAPABILITY,
    requirement: fields.requirement ?? REQUIREMENT,
    scenario: fields.scenario ?? SCENARIO,
    description: 'description' in fields ? fields.description : DESCRIPTION,
    claim: fields.claim ?? claim(),
    proof: fields.proof ?? proof(),
  }
}

export function gone(scenario = SCENARIO): GoneProof {
  return { capability: CAPABILITY, requirement: REQUIREMENT, scenario }
}

/** A review as the ledger keeps it, defaulting to a pass that cites the fixture's proof. */
export function entry(fields: {
  readonly key: string
  readonly scenario?: string
  readonly verdict?: 'ok' | 'gap' | 'drift'
  readonly by?: string
  readonly at?: string
}): ReviewEntry {
  const shared = {
    key: fields.key,
    capability: CAPABILITY,
    requirement: REQUIREMENT,
    scenario: fields.scenario ?? SCENARIO,
    by: fields.by ?? 'a reviewer',
    at: fields.at ?? '2026-08-24T00:00:00.000Z',
  }
  const verdict = fields.verdict ?? 'ok'
  if (verdict === 'ok') {
    return { ...shared, verdict, cites: { line: 20, source: 'expect(outcome).toBe(true)' } }
  }
  return { ...shared, verdict, note: 'the claim promises more than the proof asserts' }
}
