import { readSettings } from '../settings.ts'
import type { SettingsRead } from '../settings.ts'
import { mainCheckoutOf } from './git.ts'

/**
 * The settings a command a person runs reads: the file in the main checkout of the repository
 * `cwd` stands in, whether `cwd` is that checkout or one of its TASKs' worktrees — a
 * worktree's own branch may carry a stale copy, and reading it would let two places hold two
 * different settings. Kept in the CLI layer because finding the main checkout asks git;
 * `src/settings.ts` itself only reads a file.
 */
export async function readCommandSettings(cwd: string): Promise<SettingsRead> {
  return readSettings(await mainCheckoutOf(cwd))
}
