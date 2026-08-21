import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { compareStrings } from '../order.ts'
import type { LineRange } from '../locate/index.ts'

const run = promisify(execFile)

/**
 * The other thing `cli` owns besides the filesystem: the git process. Everything else in
 * ProofSpec is given strings; this is where the changed lines come from.
 *
 * git that cannot answer is never thrown from here. "This is not a git repository" and "that
 * revision does not exist" are answers the command has to give CI, the same way a directory
 * it cannot list is.
 */

/** How a file changed: the lines it has now and the lines it lost, or that it is wholly new. */
export type Changed =
  | {
      readonly kind: 'lines'
      /** Runs of lines as the file stands now. */
      readonly ranges: readonly LineRange[]
      /** Runs of lines as the base revision had them, gone or rewritten since. */
      readonly removed: readonly LineRange[]
    }
  /** A file git has never seen: there is no base to diff against, so all of it is new. */
  | { readonly kind: 'new-file' }

export type ChangedFile = {
  readonly path: string
  readonly changed: Changed
}

/** The changed tests, or the reason git could not be asked. */
export type DiffRead =
  | { readonly ok: true; readonly base: string; readonly files: readonly ChangedFile[] }
  | { readonly ok: false; readonly reason: string }

/** The branch a task's work is measured from, and merged back into. */
const INTEGRATION_BRANCH = 'main'

/**
 * Every test file the working tree has changed since the base revision, with the lines that
 * changed in each. The base is where this branch left `main` unless a revision is named, so
 * run inside a worktree with no arguments it answers "what did this branch touch".
 *
 * It reads the working tree, not just what is committed: in a worktree most of the work is
 * uncommitted most of the time, and files not yet added to git are counted for the same
 * reason — a brand new test file is exactly what a new capability looks like.
 */
export async function readChangedTests(options: {
  readonly cwd: string
  readonly testsDir: string
  readonly since: string | undefined
}): Promise<DiffRead> {
  const inWorkTree = await git(options.cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inWorkTree?.trim() !== 'true') return { ok: false, reason: `${options.cwd} is not a git repository` }

  const named = options.since ?? (await git(options.cwd, ['merge-base', 'HEAD', INTEGRATION_BRANCH]))?.trim()
  if (named === undefined) {
    return { ok: false, reason: `could not find where this branch left ${INTEGRATION_BRANCH}; name a revision with --since` }
  }
  const base = (await git(options.cwd, ['rev-parse', '--verify', `${named}^{commit}`]))?.trim()
  if (base === undefined) return { ok: false, reason: `${named} is not a revision this repository has` }

  // The prefixes are pinned rather than taken from config, because `diff.noprefix` in a
  // person's global config would otherwise change what this parses.
  const diff = await git(options.cwd, [
    'diff', '--unified=0', '--no-color', '--no-renames', '--relative',
    '--src-prefix=a/', '--dst-prefix=b/', base, '--', options.testsDir,
  ])
  if (diff === undefined) return { ok: false, reason: `git could not diff ${options.testsDir} against ${base}` }

  const untracked = await git(options.cwd, ['ls-files', '--others', '--exclude-standard', '--', options.testsDir])
  const files = [...parseDiff(diff), ...newFiles(untracked ?? '')]
  return { ok: true, base, files: files.sort((a, b) => compareStrings(a.path, b.path)) }
}

/** A file's contents at a revision, or `undefined` when that revision does not hold it. */
export async function readFileAt(options: {
  readonly cwd: string
  readonly rev: string
  readonly path: string
}): Promise<string | undefined> {
  // `:./path` reads the path as written here — relative to the directory git runs in, the
  // same anchor the diff's paths use.
  return await git(options.cwd, ['show', `${options.rev}:./${options.path}`])
}

async function git(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', [...args], { cwd, maxBuffer: MAX_OUTPUT })
    return stdout
  } catch {
    return undefined
  }
}

// A whole repository's diff has to fit: the default 1MB is small enough that a large branch
// would fail as "cannot run" when git answered perfectly well.
const MAX_OUTPUT = 64 * 1024 * 1024

const OLD_FILE = /^--- (?:a\/(.+)|\/dev\/null)$/
const NEW_FILE = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function newFiles(untracked: string): ChangedFile[] {
  return untracked
    .split('\n')
    .filter(path => path.length > 0)
    .map(path => ({ path, changed: { kind: 'new-file' } }))
}

/**
 * The `--unified=0` diff, read as line ranges per file. Both sides are kept: the new side is
 * where a scenario lives now, and the old side is the only record of one the change deleted.
 */
function parseDiff(diff: string): ChangedFile[] {
  const files = new Map<string, { ranges: LineRange[]; removed: LineRange[] }>()
  let before: string | undefined
  let current: { ranges: LineRange[]; removed: LineRange[] } | undefined

  for (const line of diff.split('\n')) {
    const old = OLD_FILE.exec(line)
    if (old !== null) {
      before = old[1]
      continue
    }
    const now = NEW_FILE.exec(line)
    if (now !== null) {
      // A deleted file has no new side; it is still reported under the path it had.
      const path = now[1] ?? before
      current = path === undefined ? undefined : held(files, path)
      continue
    }
    const hunk = HUNK.exec(line)
    if (hunk === null || current === undefined) continue
    push(current.removed, { at: hunk[1]!, count: hunk[2] })
    push(current.ranges, { at: hunk[3]!, count: hunk[4] })
  }

  return [...files].map(([path, changed]) => ({ path, changed: { kind: 'lines', ...changed } }))
}

/** A hunk with no count on a side changed one line there; with a count of zero, none. */
function push(ranges: LineRange[], hunk: { readonly at: string; readonly count: string | undefined }): void {
  const count = hunk.count === undefined ? 1 : Number(hunk.count)
  if (count === 0) return
  const from = Number(hunk.at)
  ranges.push({ from, to: from + count - 1 })
}

function held(files: Map<string, { ranges: LineRange[]; removed: LineRange[] }>, path: string) {
  const found = files.get(path) ?? { ranges: [], removed: [] }
  files.set(path, found)
  return found
}
