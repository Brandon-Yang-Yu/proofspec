import { compareStrings } from '../order.ts'
import type { TermSpec } from '../spec-file/index.ts'
import type { TermChange } from './types.ts'

/**
 * Which terms changed between the base revision's vocabulary and the one that stands now,
 * compared by word and whole definition, in name order. A term moved to another file or
 * re-ordered beside its neighbours is the same definition and changes nothing.
 */
export function changedTerms(vocabularies: {
  readonly before: readonly TermSpec[]
  readonly after: readonly TermSpec[]
}): readonly TermChange[] {
  const was = new Map(vocabularies.before.map(one => [one.term, one.definition]))
  const stands = new Map(vocabularies.after.map(one => [one.term, one.definition]))

  const names = [...new Set([...was.keys(), ...stands.keys()])]
  return names
    .filter(name => was.get(name) !== stands.get(name))
    .sort(compareStrings)
    .map(term => {
      const before = was.get(term)
      const after = stands.get(term)
      if (before === undefined) return { kind: 'new', term, after: after! }
      if (after === undefined) return { kind: 'gone', term, before }
      return { kind: 'reworded', term, before, after }
    })
}
