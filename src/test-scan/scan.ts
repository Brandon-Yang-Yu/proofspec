import type { FileScan } from './types.ts'

/**
 * Reads one TypeScript test file and reports the proof sites it holds.
 *
 * Takes the source rather than a path: the scan parses, it never type-checks, so there is
 * nothing about a file it needs from the project around it.
 */
export function scanSource(source: string, options: { file: string }): FileScan {
  void source
  void options
  throw new Error('test-scan: scanSource is not implemented yet')
}
