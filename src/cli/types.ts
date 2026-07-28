/**
 * What running a command produces, and what a run is given. `cli` is the one capability
 * that owns the filesystem and the process, so this is where a verdict finally becomes an
 * exit code — but not here in the type. `guard` returns a verdict rather than an exit code
 * (design.md §18), and `cli` keeps that boundary: the command produces an `Outcome`, and
 * turning it into a number a process exits with is `render`'s job.
 */

import type { GuardReport } from '../guard/index.ts'

/** Where a repo keeps its capability files and its tests, both as directories under the root. */
export type Locations = {
  readonly specsDir: string
  readonly testsDir: string
}

/**
 * What a command is asked to do. The locations are optional because the conventional layout
 * needs none: left out, they fall back to `specs/` and `tests/`, which is what lets the
 * check run in an ordinary repo with no configuration. `out` is the directory `render` writes
 * its pages into; left out, it falls back to `build/` at the repo root. It is a generated
 * output, so a project gitignores it rather than committing it.
 */
export type RunOptions = { readonly cwd: string; readonly out?: string } & Partial<Locations>

/**
 * The result of a command, as a value. `cannot-run` is kept apart from a checked report on
 * purpose: CI has to tell "your spec has drifted" from "I could not read my inputs", and a
 * union says which happened without a caller having to infer it from an exit code.
 *
 * `wrote.files` names files the way each command anchors them: `write` reports repo-relative
 * paths because they are the committed entries' paths, while `render` keeps the spelling the
 * out directory was given — absolute in, absolute out — so the answer names the pages where
 * the caller will look for them.
 */
export type Outcome =
  | { readonly kind: 'checked'; readonly report: GuardReport }
  | { readonly kind: 'wrote'; readonly files: readonly string[] }
  | { readonly kind: 'cannot-run'; readonly reason: string }
