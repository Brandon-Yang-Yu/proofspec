import type { ManifestBase, ManifestRead } from './types.ts'

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
  const base = readBase(record['base'])
  if (base === undefined) return { ok: false, reason: 'the MANIFEST is missing its base field, or names a base that does not stand' }

  return { ok: true, manifest: { intentRef, branch, base } }
}

function readBase(value: unknown): ManifestBase | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['kind'] === 'main') return { kind: 'main' }
  if (record['kind'] !== 'task') return undefined
  const task = record['task']
  const reason = record['reason']
  if (typeof task !== 'string' || typeof reason !== 'string') return undefined
  return { kind: 'task', task, reason }
}
