import { compareStrings } from '../order.ts'
import type { Relationship } from '../dispatch/index.ts'

/** A relationship's identity for the raised-record: the node it shares plus the TASKs it names. */
export function relationshipKey(relationship: Relationship): string {
  return `${relationship.node.kind}:${relationship.node.name}:${[...relationship.tasks].sort(compareStrings).join(',')}`
}

/**
 * Requirement: The same finding is not raised to a human twice
 *
 * Filters the graph's relationships down to the ones a human has not already seen: the fresh
 * agent judged them unresolved, and no earlier pass has raised the same key. This concerns only
 * the relationships the judge could not resolve — a resolved one was never a candidate to raise
 * at all.
 */
export function toRaise(input: {
  readonly relationships: readonly Relationship[]
  readonly verdicts: ReadonlyMap<string, 'resolved' | 'unresolved'>
  readonly alreadyRaised: ReadonlySet<string>
}): readonly Relationship[] {
  return input.relationships.filter(relationship => {
    const key = relationshipKey(relationship)
    return input.verdicts.get(key) === 'unresolved' && !input.alreadyRaised.has(key)
  })
}
