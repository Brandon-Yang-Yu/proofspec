import { rmSync } from 'node:fs'
import { DEFAULT_COVERAGE_FILE } from './record.ts'

/**
 * Vitest's `globalSetup`, which runs once in the main process before any worker starts. It
 * clears the file the per-test collector appends to, so a run's records are that run's and
 * not a pile of every run since the file was made.
 */
export default function setup(): void {
  rmSync(process.env.PROOFSPEC_COVERAGE ?? DEFAULT_COVERAGE_FILE, { force: true })
}
