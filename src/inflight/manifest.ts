import type { Manifest, ManifestRead } from './types.ts'

/**
 * Reads a MANIFEST from its JSON text. A hand-off nobody can trust is worse than none, so
 * anything short of every required field in its right shape is refused before anything is
 * built from it, naming why.
 */
export function readManifest(source: string): ManifestRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    return { ok: false, reason: `the MANIFEST is not valid JSON: ${(error as Error).message}` }
  }

  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const intentRef = record['intentRef']
  if (typeof intentRef !== 'string') return { ok: false, reason: 'the MANIFEST is missing its intentRef field' }
  const branch = record['branch']
  if (typeof branch !== 'string') return { ok: false, reason: 'the MANIFEST is missing its branch field' }
  const blocked = readBlocked(record['blocked'])
  if (blocked !== undefined && !blocked.ok) return { ok: false, reason: blocked.reason }

  return blocked === undefined
    ? { ok: true, manifest: { intentRef, branch } }
    : { ok: true, manifest: { intentRef, branch, blocked: blocked.blocked } }
}

/** A `blocked` field: absent means blocked by nothing, and present means it must carry both
 *  its `task` and its `reason` — a field that names a blocker without saying why, or argues
 *  a wait behind nobody, is refused naming the limb it stands without. */
function readBlocked(
  value: unknown,
): { readonly ok: true; readonly blocked: { readonly task: string; readonly reason: string } } | { readonly ok: false; readonly reason: string } | undefined {
  if (value === undefined) return undefined
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const task = record['task']
  const reason = record['reason']
  if (typeof task !== 'string') return { ok: false, reason: 'the MANIFEST carries a blocked that is missing its task' }
  if (typeof reason !== 'string') return { ok: false, reason: 'the MANIFEST carries a blocked that is missing its reason' }
  return { ok: true, blocked: { task, reason } }
}
