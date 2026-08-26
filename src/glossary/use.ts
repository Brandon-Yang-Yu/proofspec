import { compareStrings } from '../order.ts'
import type { TermSpec } from '../spec-file/index.ts'

/**
 * The terms a text uses. A use is a whole word in the exact form the term was defined in —
 * the convention is the matcher, so there is no case folding and no plurals here: TURN
 * matches TURN and nothing else.
 */
export function termsUsed(text: string, terms: readonly string[]): ReadonlySet<string> {
  const used = new Set<string>()
  for (const term of terms) {
    if (wholeWord(term).test(text)) used.add(term)
  }
  return used
}

/**
 * The definitions of every term the texts use, directly or through another term's
 * definition, in name order. A definition that leans on another term leans on it in every
 * promise that uses the first term, so a promise's standard carries the whole chain — which
 * is also why a change anywhere along the chain re-keys the promises hanging off it.
 */
export function definitionsFor(texts: readonly string[], terms: readonly TermSpec[]): readonly TermSpec[] {
  const names = terms.map(one => one.term)
  const reached = new Set(texts.flatMap(text => [...termsUsed(text, names)]))

  // A term reached only through another term's definition is reached all the same: the
  // definition of a term the standard uses is part of that standard, whatever it leans
  // on. The walk follows an already-reached term *into* its definition — the reverse of
  // `reopenedByTerms`, which follows a changed term *out* to everything leaning on it,
  // because keying asks what a promise uses while re-opening asks what a change touches.
  // It runs to a fixpoint rather than recursing, because a vocabulary may chain any
  // number of terms deep and the fixpoint needs no depth limit to be right.
  let grew = true
  while (grew) {
    grew = false
    for (const term of terms) {
      if (!reached.has(term.term)) continue
      for (const used of termsUsed(term.definition, names)) {
        if (reached.has(used)) continue
        reached.add(used)
        grew = true
      }
    }
  }

  return terms.filter(one => reached.has(one.term)).sort((a, b) => compareStrings(a.term, b.term))
}

/** The term as a pattern matching it and nothing else: exact form, whole word, both edges. */
function wholeWord(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`)
}
