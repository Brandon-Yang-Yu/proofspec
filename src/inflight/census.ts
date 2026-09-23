import { changedTerms } from '../glossary/index.ts'
import type { TermChange } from '../glossary/index.ts'
import { compareStrings } from '../order.ts'
import type { CapabilitySpec } from '../spec-file/index.ts'
import type { TaskFailure } from './graph.ts'

/**
 * How one requirement's prose moved between the BASE_BRANCH and a TASK's branch tip. Mirrors
 * `TermChange`'s three arms exactly — reworded, new, gone — so a reader who knows one knows
 * the other. There is no arm for a requirement that did not move, for the same reason
 * `TermChange` carries none: a row nobody has rewritten is not part of what a TASK's branch
 * has to answer for.
 */
export type RequirementChange =
  | { readonly kind: 'reworded'; readonly requirement: string; readonly before: string; readonly after: string }
  | { readonly kind: 'new'; readonly requirement: string; readonly after: string }
  | { readonly kind: 'gone'; readonly requirement: string; readonly before: string }

/**
 * Which requirements changed between the BASE_BRANCH and a TASK's branch tip, compared by name
 * and whole description. A requirement moved to another file or re-ordered beside its
 * neighbours is the same description and changes nothing.
 */
export function changedRequirements(revisions: {
  readonly before: readonly { readonly requirement: string; readonly description: string }[]
  readonly after: readonly { readonly requirement: string; readonly description: string }[]
}): readonly RequirementChange[] {
  const was = new Map(revisions.before.map(one => [one.requirement, one.description]))
  const stands = new Map(revisions.after.map(one => [one.requirement, one.description]))

  const names = [...new Set([...was.keys(), ...stands.keys()])]
  return names
    .filter(name => was.get(name) !== stands.get(name))
    .sort(compareStrings)
    .map((requirement): RequirementChange => {
      const before = was.get(requirement)
      const after = stands.get(requirement)
      if (before === undefined) return { kind: 'new', requirement, after: after! }
      if (after === undefined) return { kind: 'gone', requirement, before }
      return { kind: 'reworded', requirement, before, after }
    })
}

/** One capability file as read at both ends of a TASK's own basis. */
export type CapabilityRead = {
  readonly capability: string
  readonly before: CapabilitySpec
  readonly after: CapabilitySpec
}

/** One capability file's rewritten rows for one in-flight TASK. */
export type CapabilityRewrite = {
  readonly capability: string
  readonly requirements: readonly RequirementChange[]
  readonly terms: readonly TermChange[]
}

/** Absent when neither the requirements nor the TERMs moved — the same omission `changedTerms`
 * and `changedRequirements` already make at the row level, carried up to the file level. */
function rewriteOf(read: CapabilityRead): CapabilityRewrite | undefined {
  const requirements = changedRequirements({ before: read.before.requirements, after: read.after.requirements })
  const terms = changedTerms({ before: read.before.terms, after: read.after.terms })
  if (requirements.length === 0 && terms.length === 0) return undefined
  return { capability: read.capability, requirements, terms }
}

/** One in-flight TASK's capability files, as read at both ends of its own basis. */
export type TaskCapabilityReads = {
  readonly task: string
  readonly branch: string
  readonly capabilities: readonly CapabilityRead[]
}

/** One in-flight TASK's rewritten rows. Absent from the census entirely when it rewrote nothing. */
export type TaskRewrite = {
  readonly task: string
  readonly branch: string
  readonly capabilities: readonly CapabilityRewrite[]
}

/** What the queue-aware census answers: every in-flight TASK that rewrote something, and a
 * named problem for any TASK whose own census could not be read. */
export type Census = {
  readonly tasks: readonly TaskRewrite[]
  readonly failures: readonly TaskFailure[]
}

/**
 * Computes the census from every in-flight TASK's already-read capability files. Pure:
 * everything git had to answer is already folded into `reads` by the time this runs.
 */
export function computeCensus(input: {
  readonly reads: readonly TaskCapabilityReads[]
  readonly failures: readonly TaskFailure[]
}): Census {
  const tasks = input.reads
    .map((read): TaskRewrite => ({
      task: read.task,
      branch: read.branch,
      capabilities: read.capabilities
        .map(rewriteOf)
        .filter((one): one is CapabilityRewrite => one !== undefined),
    }))
    .filter(task => task.capabilities.length > 0)
  return { tasks, failures: input.failures }
}
