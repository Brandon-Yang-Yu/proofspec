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
 * Every file under the given paths the working tree has changed since the base revision, with
 * the lines that changed in each. The base is where this branch left `main` unless a revision is named, so
 * run inside a worktree with no arguments it answers "what did this branch touch".
 *
 * It reads the working tree, not just what is committed: in a worktree most of the work is
 * uncommitted most of the time, and files not yet added to git are counted for the same
 * reason — a brand new test file is exactly what a new capability looks like.
 */
export async function readChangedFiles(options: {
  readonly cwd: string
  /** What to diff, as git pathspecs: a directory, or everything but one. */
  readonly paths: readonly string[]
  readonly since: string | undefined
}): Promise<DiffRead> {
  const inWorkTree = await git(options.cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inWorkTree?.trim() !== 'true') return { ok: false, reason: `${options.cwd} is not a git repository` }

  const named = options.since ?? (await defaultBase(options.cwd))
  if (named === undefined) {
    return { ok: false, reason: `could not find where this branch left ${INTEGRATION_BRANCH}; name a revision with --since` }
  }
  const base = (await git(options.cwd, ['rev-parse', '--verify', `${named}^{commit}`]))?.trim()
  if (base === undefined) return { ok: false, reason: `${named} is not a revision this repository has` }

  // The prefixes are pinned rather than taken from config, because `diff.noprefix` in a
  // person's global config would otherwise change what this parses.
  const diff = await git(options.cwd, [
    'diff', '--unified=0', '--no-color', '--no-renames', '--relative',
    '--src-prefix=a/', '--dst-prefix=b/', base, '--', ...options.paths,
  ])
  if (diff === undefined) return { ok: false, reason: `git could not diff against ${base}` }

  const untracked = await git(options.cwd, ['ls-files', '--others', '--exclude-standard', '--', ...options.paths])
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

/**
 * Where a run that named no revision measures from. Off `main` that is the branch point.
 * On `main` the branch point is `HEAD` itself, which would answer "nothing touched" over
 * commits the next push is about to publish — the very list a held push sends a reader to
 * work through — so there the base is where the published tip stands: `main`'s upstream
 * when one is configured, else the conventional `origin` tracking ref a fetch leaves
 * behind. A repo with neither keeps the branch point: nothing is published to measure from.
 */
async function defaultBase(cwd: string): Promise<string | undefined> {
  const head = (await git(cwd, ['rev-parse', 'HEAD']))?.trim()
  const branchPoint = (await git(cwd, ['merge-base', 'HEAD', INTEGRATION_BRANCH]))?.trim()
  if (head === undefined || branchPoint === undefined) return undefined
  if (branchPoint !== head) return branchPoint

  const published =
    (await git(cwd, ['rev-parse', '--verify', `${INTEGRATION_BRANCH}@{upstream}`]))?.trim() ??
    (await git(cwd, ['rev-parse', '--verify', `refs/remotes/origin/${INTEGRATION_BRANCH}`]))?.trim()
  if (published === undefined) return branchPoint
  return (await git(cwd, ['merge-base', 'HEAD', published]))?.trim() ?? branchPoint
}

/** Where two revisions last agreed, or the reason git could not answer. */
export type MergeBaseRead = { readonly ok: true; readonly base: string } | { readonly ok: false; readonly reason: string }

/** A list of paths, or the reason git could not answer. */
export type PathsRead = { readonly ok: true; readonly paths: readonly string[] } | { readonly ok: false; readonly reason: string }

/** Whether one revision is an ancestor of another, or the reason git could not answer. */
export type AncestorRead = { readonly ok: true; readonly isAncestor: boolean } | { readonly ok: false; readonly reason: string }

/**
 * Where two named revisions last agreed, without checking either one out. `dispatch` measures
 * a task's branch against another task's, or against `main`, and neither is the working tree.
 */
export async function mergeBase(options: { readonly cwd: string; readonly a: string; readonly b: string }): Promise<MergeBaseRead> {
  const a = await verifiedRevision(options.cwd, options.a)
  if (a === undefined) return { ok: false, reason: `${options.a} is not a revision this repository has` }
  const b = await verifiedRevision(options.cwd, options.b)
  if (b === undefined) return { ok: false, reason: `${options.b} is not a revision this repository has` }
  const base = (await git(options.cwd, ['merge-base', a, b]))?.trim()
  if (base === undefined) return { ok: false, reason: `${options.a} and ${options.b} share no common history` }
  return { ok: true, base }
}

/** The paths under a pathspec that differ between two revisions, name-only. */
export async function changedPathsBetween(options: {
  readonly cwd: string
  readonly from: string
  readonly to: string
  readonly paths: readonly string[]
}): Promise<PathsRead> {
  const from = await verifiedRevision(options.cwd, options.from)
  if (from === undefined) return { ok: false, reason: `${options.from} is not a revision this repository has` }
  const to = await verifiedRevision(options.cwd, options.to)
  if (to === undefined) return { ok: false, reason: `${options.to} is not a revision this repository has` }
  const diff = await git(options.cwd, ['diff', '--name-only', from, to, '--', ...options.paths])
  if (diff === undefined) return { ok: false, reason: `git could not diff ${options.from} against ${options.to}` }
  return { ok: true, paths: linesOf(diff).sort(compareStrings) }
}

/** Every path either of two revisions holds, under a pathspec. */
export async function pathsAtEither(options: {
  readonly cwd: string
  readonly a: string
  readonly b: string
  readonly paths: readonly string[]
}): Promise<PathsRead> {
  const a = await verifiedRevision(options.cwd, options.a)
  if (a === undefined) return { ok: false, reason: `${options.a} is not a revision this repository has` }
  const b = await verifiedRevision(options.cwd, options.b)
  if (b === undefined) return { ok: false, reason: `${options.b} is not a revision this repository has` }
  const atA = await git(options.cwd, ['ls-tree', '-r', '--name-only', a, '--', ...options.paths])
  const atB = await git(options.cwd, ['ls-tree', '-r', '--name-only', b, '--', ...options.paths])
  if (atA === undefined || atB === undefined) {
    return { ok: false, reason: `git could not list paths at ${options.a} and ${options.b}` }
  }
  const paths = new Set([...linesOf(atA), ...linesOf(atB)])
  return { ok: true, paths: [...paths].sort(compareStrings) }
}

/**
 * Whether `ancestor` is an ancestor of `descendant`. `git merge-base --is-ancestor` answers
 * through its exit code alone — 0 true, 1 false, anything else a real failure — so this cannot
 * share the swallow-everything `git()` wrapper below: that would read "not an ancestor" as
 * indistinguishable from "git broke".
 */
export async function isAncestor(options: {
  readonly cwd: string
  readonly ancestor: string
  readonly descendant: string
}): Promise<AncestorRead> {
  const ancestor = await verifiedRevision(options.cwd, options.ancestor)
  if (ancestor === undefined) return { ok: false, reason: `${options.ancestor} is not a revision this repository has` }
  const descendant = await verifiedRevision(options.cwd, options.descendant)
  if (descendant === undefined) return { ok: false, reason: `${options.descendant} is not a revision this repository has` }
  try {
    await run('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: options.cwd })
    return { ok: true, isAncestor: true }
  } catch (error) {
    if ((error as { readonly code?: number }).code === 1) return { ok: true, isAncestor: false }
    return { ok: false, reason: `git could not check whether ${options.ancestor} is an ancestor of ${options.descendant}` }
  }
}

/** A revision confirmed to exist, resolved to its commit — or `undefined` when it does not. */
async function verifiedRevision(cwd: string, rev: string): Promise<string | undefined> {
  return (await git(cwd, ['rev-parse', '--verify', `${rev}^{commit}`]))?.trim()
}

/** Non-empty lines of a command's output, split the way git's `--name-only` output separates them. */
function linesOf(output: string): string[] {
  return output.split('\n').filter(line => line.length > 0)
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
