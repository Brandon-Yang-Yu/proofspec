import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { enqueue } from '../cli/queue.ts'
import type { Manifest, ManifestBase } from '../inflight/index.ts'

/** The flattened shape `enqueue_task` accepts from a model, before it is mapped onto the
 *  real `Manifest`/`ManifestBase` `readManifest` (`src/inflight/manifest.ts`) already parses. */
export type EnqueueTaskInput = {
  readonly task: string
  readonly intentRef: string
  readonly branch: string
  readonly base?: { readonly task: string; readonly reason: string }
}

/** Whether a TASK name is safe to use as a filesystem path segment at all. */
export type TaskNameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const TASK_NAME_PATTERN = /^[a-z]([a-z0-9-]*[a-z0-9])?$/

/**
 * `enqueue(cwd, task, manifest)` (`src/cli/queue.ts`) builds its path as `join(cwd,
 * '.proofspec', 'dispatch', task)` with no check at all on `task` — safe until now only
 * because nothing ever called it with a `task` that did not already come from a trusted
 * caller. This is the first caller whose `task` arrives from a model's own text, so the
 * shape this repo's own TASK names already follow has to become an actual gate, run before
 * `enqueue()`'s own `join` ever sees the value.
 */
export function checkTaskName(task: string): TaskNameCheck {
  if (TASK_NAME_PATTERN.test(task)) return { ok: true }
  return {
    ok: false,
    reason: `"${task}" is not a plain kebab-case slug: it must start with a lowercase letter and contain only lowercase letters, digits, and hyphens, with no trailing hyphen`,
  }
}

/** Maps `enqueue_task`'s flattened input onto the exact `Manifest` shape `readManifest` parses. */
export function manifestFrom(input: EnqueueTaskInput): Manifest {
  const base: ManifestBase =
    input.base === undefined ? { kind: 'main' } : { kind: 'task', task: input.base.task, reason: input.base.reason }
  return { intentRef: input.intentRef, branch: input.branch, base }
}

export type EnqueueTaskResult = { readonly ok: true; readonly task: string } | { readonly ok: false; readonly reason: string }

/**
 * The whole of `enqueue_task`'s own job: validate the TASK name, flatten the input onto a
 * real `Manifest`, then answer exactly what `enqueue()` answers — its own write outcome is
 * `enqueue()`'s to decide, not re-judged here.
 */
export async function runEnqueueTask(cwd: string, input: EnqueueTaskInput): Promise<EnqueueTaskResult> {
  const nameCheck = checkTaskName(input.task)
  if (!nameCheck.ok) return nameCheck

  const manifest = manifestFrom(input)
  const result = await enqueue(cwd, input.task, manifest)
  if (!result.ok) return result
  return { ok: true, task: input.task }
}

/** The plain JSON Schema `enqueue_task`'s arguments must satisfy — no TypeBox schema needed,
 *  pi's own tool-argument validation falls back to plain JSON Schema when a schema carries
 *  no TypeBox marker. */
const ENQUEUE_TASK_PARAMETERS = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'The TASK name — a plain kebab-case slug, e.g. "fix-login-redirect"' },
    intentRef: { type: 'string', description: "Where this TASK's intent is written, e.g. a spec or doc path" },
    branch: { type: 'string', description: "The TASK's own branch name" },
    base: {
      type: 'object',
      description: 'The other TASK this one is built on, when it is not built on main',
      properties: {
        task: { type: 'string', description: 'The other TASK name' },
        reason: { type: 'string', description: 'Why this TASK is built on it' },
      },
      required: ['task', 'reason'],
    },
  },
  required: ['task', 'intentRef', 'branch'],
} as const

function toolResultFrom(result: EnqueueTaskResult): { content: [{ type: 'text'; text: string }]; details: EnqueueTaskResult } {
  const text = result.ok ? `TASK "${result.task}" is now queued.` : `Could not enqueue: ${result.reason}`
  return { content: [{ type: 'text', text }], details: result }
}

/** The real `pi` extension: registers `enqueue_task` as a tool a coding agent inside `pi`
 *  can call directly, instead of a human hand-writing a MANIFEST by hand. */
export default function handoffExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'enqueue_task',
    label: 'Enqueue Task',
    description: "Hands a TASK off to ProofSpec's queue, creating its MANIFEST and initial queued state.",
    parameters: ENQUEUE_TASK_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const result = await runEnqueueTask(ctx.cwd, params)
      return toolResultFrom(result)
    },
  })
}
