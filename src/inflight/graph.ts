import { termsStandingOn, termsUsed } from '../glossary/index.ts'
import { compareStrings } from '../order.ts'
import type { BlockedBy, Graph, Node, TaskEntry } from './types.ts'

/** The one capability file every TERM lives in — never itself a shared node a relationship names. */
export const GLOSSARY_CAPABILITY = 'glossary'

/** A TERM as `computeGraph` needs it: its name and the definition `termsStandingOn` walks. */
export type VocabularyTerm = { readonly term: string; readonly definition: string }

/** One other CAPABILITY_FILE's words, as read at the revision the graph measures against. */
export type VocabularyCapability = { readonly capability: string; readonly texts: readonly string[] }

/** The shared spec `computeGraph` checks a TASK's changes against. */
export type Vocabulary = {
  readonly terms: readonly VocabularyTerm[]
  readonly capabilities: readonly VocabularyCapability[]
}

/** What one in-flight TASK's branch changed, relative to the BASE_BRANCH, plus the blockedBy
 *  edge its MANIFEST records. */
export type TaskChange = {
  readonly task: string
  readonly editedCapabilities: readonly string[]
  readonly changedTerms: readonly string[]
  readonly blockedBy: BlockedBy | undefined
}

/** A TASK whose MANIFEST or branch could not be read at all. */
export type TaskFailure = { readonly task: string; readonly reason: string }

/**
 * Builds the graph from every in-flight TASK's already-measured changes. Pure: everything git
 * had to answer is already folded into `changes` and `vocabulary` by the time this runs.
 */
export function computeGraph(input: {
  readonly changes: readonly TaskChange[]
  readonly failures: readonly TaskFailure[]
  readonly vocabulary: Vocabulary
  /** Every TASK name standing on the queue, merged ones included: the names a `blocked`
   *  may name without being a dangling name. */
  readonly queue: readonly string[]
}): Graph {
  const standing = new Set(input.queue)
  const entries = input.changes.map(change => entryFor(change, input.vocabulary, standing))
  const failed = input.failures.map(
    (failure): TaskEntry => ({ task: failure.task, writes: [], reopened: [], blockedBy: null, problem: failure.reason }),
  )
  const tasks = [...entries, ...failed].sort((a, b) => compareStrings(a.task, b.task))
  return { tasks, relationships: relationshipsAmong(entries) }
}

function entryFor(change: TaskChange, vocabulary: Vocabulary, standing: ReadonlySet<string>): TaskEntry {
  const writes: Node[] = [
    ...change.editedCapabilities.map((name): Node => ({ kind: 'capability', name })),
    ...change.changedTerms.map((name): Node => ({ kind: 'term', name })),
  ]

  const reached = termsStandingOn(change.changedTerms, vocabulary.terms)
  const written = new Set(change.editedCapabilities)
  const reopened: Node[] = vocabulary.capabilities
    .filter(capability => capability.capability !== GLOSSARY_CAPABILITY)
    .filter(capability => !written.has(capability.capability))
    .filter(capability => termsUsed(capability.texts.join('\n'), [...reached]).size > 0)
    .map((capability): Node => ({ kind: 'capability', name: capability.capability }))
    .sort((a, b) => compareStrings(a.name, b.name))

  // The edge is the manifest fact itself, drawn whether or not the named TASK stands on the
  // queue; a name the queue does not hold rides beside it as a problem, because the TASK's
  // own edges are still real even when the name it waits behind is not.
  const blockedBy: BlockedBy | null = change.blockedBy ?? null
  const problem =
    change.blockedBy !== undefined && !standing.has(change.blockedBy.task)
      ? `blocked by ${change.blockedBy.task}, which the queue does not hold`
      : null

  return { task: change.task, writes, reopened, blockedBy, problem }
}

/**
 * The relationship a shared node raises, once every node a blockedBy edge already connects
 * is left out. The glossary file is excluded from the walk entirely: every TERM lives
 * there, so two TASK that touched two unrelated words would otherwise always relate through it —
 * a fact about the format, not about the TASKs' work. A TERM node still carries the real signal.
 */
function relationshipsAmong(entries: readonly TaskEntry[]): Graph['relationships'] {
  const connected = connectedComponents(entries)

  const byNode = new Map<string, { readonly node: Node; readonly tasks: Set<string> }>()
  for (const entry of entries) {
    for (const node of [...entry.writes, ...entry.reopened]) {
      if (node.kind === 'capability' && node.name === GLOSSARY_CAPABILITY) continue
      const key = nodeKey(node)
      const held = byNode.get(key) ?? { node, tasks: new Set<string>() }
      held.tasks.add(entry.task)
      byNode.set(key, held)
    }
  }

  const relationships = [...byNode.values()]
    .filter(held => held.tasks.size >= 2)
    .map(held => ({ node: held.node, tasks: [...held.tasks].sort(compareStrings) }))
    .filter(held => !allConnected(held.tasks, connected))
    .sort((a, b) => compareStrings(nodeKey(a.node), nodeKey(b.node)))

  return relationships
}

function nodeKey(node: Node): string {
  return `${node.kind}:${node.name}`
}

/** Which TASK a blockedBy edge connects, as the component each task's name maps to. */
function connectedComponents(entries: readonly TaskEntry[]): ReadonlyMap<string, string> {
  const parent = new Map<string, string>(entries.map(entry => [entry.task, entry.task]))
  const find = (task: string): string => {
    const above = parent.get(task) ?? task
    if (above === task) return task
    const root = find(above)
    parent.set(task, root)
    return root
  }
  for (const entry of entries) {
    if (entry.blockedBy === null) continue
    if (!parent.has(entry.blockedBy.task)) continue
    parent.set(find(entry.task), find(entry.blockedBy.task))
  }
  const roots = new Map<string, string>()
  for (const task of parent.keys()) roots.set(task, find(task))
  return roots
}

function allConnected(tasks: readonly string[], components: ReadonlyMap<string, string>): boolean {
  const first = components.get(tasks[0]!)
  return tasks.every(task => components.get(task) === first)
}
