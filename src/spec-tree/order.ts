/**
 * Compares by UTF-16 code unit, not `localeCompare`. The order must be identical on every
 * machine — a tree regenerated in CI has to sort the same way the committed one did, or a
 * comparison reports a difference that is only a difference in locale.
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
