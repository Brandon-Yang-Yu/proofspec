# Acceptance report — TASK settable-main-branch

All 19 steps **PASS**, run for real by a fresh acceptance-checker against the queue
entry's acceptance script (`acceptance.md`), in the throwaway repo `/tmp/ps-accept-smb`
(deleted at step 19), with the CLI from this checkout (tarball via `pnpm pack`,
npm-installed into the throwaway — the README's documented adoption path).

## Setup / Part 1 — PROOFSPEC_BASE_BRANCH=bDev, no `main` in the repo

1. **PASS** — empty dir outside this repo, `git init` inside it.
2. **PASS** — `git branch --show-current` → `bDev`; `git branch --list main` → empty.
3. **PASS** — all 11 personas + `handoff.ts` + `progress.ts` committed; `.gitignore`
   names both `.proofspec/dispatch/` and `.proofspec/worktrees/` (plus `specs/` and
   `tests/` trees, per the README's own first-TASK queueing — `touched` reads both).
4. **PASS** — `echo $PROOFSPEC_BASE_BRANCH` → `bDev`.
5. **PASS** — one-shot pi run did investigator setup + `enqueue_task`; docket:
   `tweak-alpha queued … on tweak-alpha-branch`; the triggered pass `started 1`
   executor session. (First cut changed `README.md`, which `touched` — a spec/test-tree
   tool — can never list; re-cut the branch changing exactly one file under `tests/`
   before judging this step.)
6. **PASS** — `touched` from the TASK worktree, base `281d2cb` (= merge-base with
   `bDev`), `--unmatched` lists exactly `tests/one.test.ts:2`. A path reading `main`
   would have refused — no `main` exists.
7. **PASS** — `git merge-base --is-ancestor tweak-alpha-branch bDev` exits 0.
8. **PASS** — pass printed `merged tweak-alpha (branch landed in bDev)`,
   `pruned tweak-alpha`, exit 0, no git error naming `main`; worktree removed, entry
   archived. (The session's word reached `mergeable` through its own
   `report_task_state` after a documented human attach-and-take-over.)
9. **PASS** — second TASK `tweak-beta` queued on its own branch; `touched` lists
   exactly `tests/two.test.ts:2`, base `813469a` (bDev's tip).
10. **PASS** — pass: `blocked tweak-beta (a LEASE already stands)`, exit 0; docket
    still shows it open.
11. **PASS** — a dispatching pass (stale LEASE reclaimed past the 2-min grace) started
    the session `started tweak-beta`. In the pane: `echo $PROOFSPEC_BASE_BRANCH`
    printed `bDev`; `settle_task` answered "Could not settle: TASK tweak-beta cannot be
    settled: its branch tweak-beta-branch has not landed in bDev" — refusal naming the
    branch, touching nothing.

## Part 2 — the variable unset, the default `main`

12. **PASS** — empty line.
13. **PASS** — `main` listed at the first commit; neither task branch is its ancestor.
14. **PASS** — same command, base now `4de6f97` (first commit = where the branch left
    `main`); lists **more** than step 9: `tests/one.test.ts:1-2` (what `bDev` carries
    past `main`) + `tests/two.test.ts:1-2`.
15. **PASS** — beta landed in `bDev` (is-ancestor ✓); pass: `nothing to do`, exit 0;
    docket still `tweak-beta mergeable` — open, because the default measures `main`.
16. **PASS** — `main` fast-forwarded; pass: `merged tweak-beta (branch landed in
    main)`, `pruned tweak-beta`; queue empty, both TASKs archived.

## Gates on this repo

17. **PASS** — `pnpm test`: 89 files, 599 tests, green.
18. **PASS** — `pnpm spec:check` exit 0; scenario blocks say "landed in the
    BASE_BRANCH" / name `PROOFSPEC_BASE_BRANCH` (15 places); "landed in main" in zero
    spec files.
19. **PASS** — throwaway repo and pack scratch deleted, instrument tmux server empty;
    the worktree clean; the main checkout's only dirt predates the run — the production
    queue's own residue.

## Instrument notes

All queue operations ran with the documented `PROOFSPEC_TMUX_SOCKET=ps-accept-smb`
override — the default `proofspec` socket held live production sessions (including the
one this check ran in), and `session.ts` itself documents this override for exactly this
use. `touched` ran from TASK worktrees via `PATH` to the throwaway's
`node_modules/.bin` (same checkout-built CLI, cwd = worktree) because worktrees carry
no `node_modules`. The executor sessions were steered only through the queue's own
surfaces — `report_task_state`, `settle_task`, and the persona's attach-and-take-over —
never by editing queue files.
