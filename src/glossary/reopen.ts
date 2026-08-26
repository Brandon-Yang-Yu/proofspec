import { compareStrings } from '../order.ts'
import type { TermSpec } from '../spec-file/index.ts'
import { termsUsed } from './use.ts'
import type { PromiseStandard, ReopenedPromise, TermChange } from './types.ts'

/**
 * The texts a promise's standard is judged through: its requirement's heading and prose,
 * its own title, and the steps it claims. One home for the list, because keying a promise
 * and re-opening it must read the same texts — a term used in a place only one of them
 * looked would re-key a promise nothing re-opened, or the reverse.
 */
export function standardTexts(promise: PromiseStandard): readonly string[] {
  return [
    promise.requirement,
    promise.description ?? '',
    promise.scenario,
    ...promise.claim.map(step => step.text),
  ]
}

/**
 * The promises a changed term reaches: every promise whose standard uses the term, directly
 * or through another term's definition, carrying the root changes that reached it.
 */
export function reopenedByTerms(reach: {
  readonly changed: readonly TermChange[]
  readonly terms: readonly TermSpec[]
  readonly promises: readonly PromiseStandard[]
}): readonly ReopenedPromise[] {
  if (reach.changed.length === 0) return []

  // Which terms stand on moved ground, and which root changes put them there. A term whose
  // definition uses a changed term is itself changed — a word built on a word that moved
  // moves with it — so the change is expanded to a fixpoint before any promise is read.
  const moved = new Map<string, readonly TermChange[]>(reach.changed.map(one => [one.term, [one]]))
  let grew = true
  while (grew) {
    grew = false
    for (const term of reach.terms) {
      if (moved.has(term.term)) continue
      const roots = [...termsUsed(term.definition, [...moved.keys()])].flatMap(name => moved.get(name)!)
      if (roots.length > 0) {
        moved.set(term.term, roots)
        grew = true
      }
    }
  }

  const reopened: ReopenedPromise[] = []
  for (const promise of reach.promises) {
    const roots = rootsReaching(standardTexts(promise), moved)
    if (roots.length === 0) continue
    reopened.push({ ...promise, reopenedBy: roots })
  }
  return reopened
}

/** The root changes reaching a promise through any term its standard uses, in term order. */
function rootsReaching(
  texts: readonly string[],
  moved: ReadonlyMap<string, readonly TermChange[]>,
): readonly TermChange[] {
  const byTerm = new Map<string, TermChange>()
  for (const text of texts) {
    for (const term of termsUsed(text, [...moved.keys()])) {
      for (const root of moved.get(term)!) {
        byTerm.set(root.term, root)
      }
    }
  }
  return [...byTerm.values()].sort((a, b) => compareStrings(a.term, b.term))
}
