import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { compareStrings } from '../order.ts'

/**
 * The only part of ProofSpec that reads the filesystem. Every other capability takes a source
 * string; this is where the strings come from. A directory that cannot be listed is not
 * thrown from here — it is returned as a `cannot-run` reason, because "I could not read my
 * inputs" is an answer the command has to give CI, not a crash.
 */

/** A file read from disk: its path relative to the repo root, and its contents. */
export type SourceFile = {
  readonly path: string
  readonly source: string
}

/** A capability file, plus the capability its filename declares. */
export type SpecFileRead = SourceFile & {
  readonly capability: string
}

/** Files read, or the reason none could be. The failure is a value the command reports. */
export type Discovery<Found> =
  | { readonly ok: true; readonly files: readonly Found[] }
  | { readonly ok: false; readonly reason: string }

/** The test files under a directory, walked recursively so nested suites are found too. */
export async function readTestFiles(cwd: string, testsDir: string): Promise<Discovery<SourceFile>> {
  return readFiles(cwd, testsDir, { recursive: true, suffix: '.test.ts' })
}

/** The capability files directly under a directory, each named for the capability it holds. */
export async function readSpecFiles(cwd: string, specsDir: string): Promise<Discovery<SpecFileRead>> {
  const read = await readFiles(cwd, specsDir, { recursive: false, suffix: '.md' })
  if (!read.ok) return read
  const files = read.files.map((file): SpecFileRead => ({ ...file, capability: basename(file.path, '.md') }))
  return { ok: true, files }
}

/**
 * The matching files under one directory, in name order. Sorted here because a recursive
 * `readdir` returns filesystem order, and a scan that walked its files in a different order
 * on another machine could report the same tree differently.
 */
async function readFiles(
  cwd: string,
  dir: string,
  match: { readonly recursive: boolean; readonly suffix: string },
): Promise<Discovery<SourceFile>> {
  // `resolve` honours a location given as an absolute path, where `join` would glue it
  // onto the repo root and read from a directory nobody named.
  const base = resolve(cwd, dir)
  const names = await listDir(base, { recursive: match.recursive })
  if (names === undefined) return { ok: false, reason: `${dir} could not be read` }

  const matching = names.filter(name => name.endsWith(match.suffix)).sort(compareStrings)
  const files = await Promise.all(
    matching.map(async (name): Promise<SourceFile> => ({
      // Reported relative to the repo root however the location was spelled, because the
      // committed entries carry these paths and must not change with the spelling.
      path: relative(cwd, join(base, name)),
      source: await readFile(join(base, name), 'utf8'),
    })),
  )
  return { ok: true, files }
}

/**
 * The entries of a directory, or `undefined` when it cannot be listed. A directory that is
 * not there is the ordinary way a command is pointed at a place it cannot run, so the miss
 * is turned into a value here rather than allowed to throw out of the boundary.
 */
async function listDir(dir: string, options: { readonly recursive: boolean }): Promise<string[] | undefined> {
  try {
    return await readdir(dir, { recursive: options.recursive })
  } catch {
    return undefined
  }
}
