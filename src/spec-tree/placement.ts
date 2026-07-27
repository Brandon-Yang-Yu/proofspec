import { compareStrings } from '../order.ts'
import type { Placement } from './types.ts'

/**
 * Orders two placements by file, then line — the one canonical answer to "which proof site
 * comes first". `spec-tree`'s tree, `guard`'s report, and `locate`'s position each resolve
 * a scenario to a single site this way; one comparator keeps them from disagreeing, the
 * same reason `compareStrings` and `identityKey` are shared rather than copied.
 */
export function comparePlacements(a: Placement, b: Placement): number {
  const byFile = compareStrings(a.file, b.file)
  return byFile !== 0 ? byFile : a.line - b.line
}
