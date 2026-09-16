import { basename } from 'node:path'
import { basesFor, computeCensus } from '../inflight/index.ts'
import type { CapabilityRead, Census, TaskBasis, TaskCapabilityReads, TaskFailure } from '../inflight/index.ts'
import { readCapabilityFile } from '../spec-file/index.ts'
import type { CapabilitySpec } from '../spec-file/index.ts'
import { changedSpecPaths, readFileAt } from './git.ts'
import { readQueue, recordsFrom } from './queue.ts'

const DEFAULT_SPECS_DIR = 'specs'

/** The census, or the reason the queue directory itself could not be read. */
export type CensusRead = { readonly ok: true; readonly census: Census } | { readonly ok: false; readonly reason: string }

/**
 * Reads the conventional queue directory and answers the census `inflight` computes: every
 * in-flight TASK's own requirement and TERM rewrites, measured against the same base its
 * edges already are. An absent or empty queue answers an empty census, the same way
 * `inflight`'s own graph does; one TASK whose branch or MANIFEST cannot be read is a named
 * problem for that TASK alone, never a reason to refuse the rest.
 */
export async function readCensus(cwd: string, specsDir: string = DEFAULT_SPECS_DIR): Promise<CensusRead> {
  const queue = await readQueue(cwd)
  if (!queue.ok) return { ok: false, reason: queue.reason }
  if (queue.tasks.length === 0) return { ok: true, census: { tasks: [], failures: [] } }

  const { records, failures: recordFailures } = recordsFrom(queue.tasks)
  const failures: TaskFailure[] = [...recordFailures]

  const reads: TaskCapabilityReads[] = []
  for (const basis of basesFor(records)) {
    const read = await readTaskCapabilities(cwd, basis, specsDir)
    if (!read.ok) {
      failures.push({ task: basis.task, reason: read.reason })
      continue
    }
    reads.push(read.reads)
  }

  return { ok: true, census: computeCensus({ reads, failures }) }
}

/**
 * One in-flight TASK's changed capability files, read at both ends of its own basis. The
 * changed-paths call is the cheap filter §42 asks for before the expensive read: it names
 * only the capability files this TASK actually edited, so a file nobody touched is never
 * parsed at either end.
 */
async function readTaskCapabilities(
  cwd: string,
  basis: TaskBasis,
  specsDir: string,
): Promise<{ readonly ok: true; readonly reads: TaskCapabilityReads } | { readonly ok: false; readonly reason: string }> {
  const changed = await changedSpecPaths({ cwd, branch: basis.manifest.branch, against: basis.against, specsDir })
  if (!changed.ok) return { ok: false, reason: changed.reason }

  const capabilities: CapabilityRead[] = []
  for (const path of changed.paths) {
    const capability = basename(path, '.md')
    const before = await capabilitySpecAt({ cwd, rev: changed.base, path, capability })
    const after = await capabilitySpecAt({ cwd, rev: basis.manifest.branch, path, capability })
    capabilities.push({ capability, before, after })
  }
  return { ok: true, reads: { task: basis.task, branch: basis.manifest.branch, capabilities } }
}

/** A capability file as one revision holds it — an empty spec when that revision never held
 * the file at all, the same way `measure` (`src/cli/run.ts`) already treats a base that never
 * saw a file: every row in it is new relative to nothing. */
async function capabilitySpecAt(options: {
  readonly cwd: string
  readonly rev: string
  readonly path: string
  readonly capability: string
}): Promise<CapabilitySpec> {
  const source = (await readFileAt(options)) ?? ''
  return readCapabilityFile(source, { capability: options.capability })
}
