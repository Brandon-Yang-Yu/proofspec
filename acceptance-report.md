# Acceptance report — `socket-per-repo` (final run)

Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/socket-per-repo` @ `1c4fc21` (branch `socket-per-repo`, clean tree).

**Step 1 — `pnpm test` — PASS.** Suite green: 93 files, 625 tests, 0 failures. The named scenarios are present in `tests/schedule/session.test.ts` and pass (verified with `--reporter=verbose` on the file): the new derivation scenario at line 687 ("The default socket is derived from the queue root, so two repos never share a server"), the override scenario at line 803 ("PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target"), and the dedicated-server scenario at line 669 — its title now reads "…a dedicated server whose name is derived from the queue root, never the user's default or any other named one", i.e. the same proof target restated with the derivation rule the branch introduces, consistent with the rewritten requirements step 3 checks. Unchanged in what they prove.

**Step 2 — `pnpm typecheck` — PASS.** `tsc -p tsconfig.json`, exit 0.

**Step 3 — `spec:write` then `spec spec:check` — PASS.** `write` reported "nothing to write"; `check` exited 0. Its one output line ("Term MANIFEST: … everyday form…") is a `term-near-form` finding, which `src/guard/report.ts` classifies as warn severity ("the findings that warn rather than fail"), not drift — the drift kinds are fails and none appeared.

**Step 4 — two scratch queue roots — PASS.** Worktree cloned to `~/scratch/socket-root-a` and `-b`; `pnpm install` done in each. Root A: branch `scratch/toy-alpha` with one commit, `.proofspec/dispatch/toy-alpha/` holding MANIFEST (`{"intentRef":"INTENT","branch":"scratch/toy-alpha","base":{"kind":"main"}}`), INTENT ("Report `building`, then stop — this TASK builds nothing."), state `queued`. Root B identical for `toy-beta`. Per the prior run's note, each clone's HEAD was moved back to the default branch after the toy branch was made — the later dispatches created worktrees without the already-checked-out-branch failure.

**Step 5 — dispatch both — PASS.** `env -u PROOFSPEC_TMUX_SOCKET pnpm proofspec schedule` in each root: "started toy-alpha" and "started toy-beta", exit 0. Standard verified at the pane level: each session's pane runs the harness with cwd `/Users/yang/scratch/socket-root-a/.proofspec/worktrees/toy-alpha` and `…/socket-root-b/.proofspec/worktrees/toy-beta` respectively — the TASK's own worktree, headed.

**Step 6 — read the derived names — PASS.** `TMUX_TMPDIR` unset, so `/tmp/tmux-501/`. Diffing the `proofspec-<8hex>` socket set before/after dispatch: exactly two new sockets, `proofspec-4dec2301` and `proofspec-aad3a025`, both live. Both match names computed independently beforehand from the SHA-256 of each clone's realpath (root-a → `4dec2301`, root-b → `aad3a025`) — the names derive from the queue root's absolute path, and the two clones' paths differ, so the names differ.

**Step 7 — each server's contents — PASS.** `tmux -L proofspec-4dec2301 list-sessions` → `toy-alpha: 1 windows`, nothing else. `tmux -L proofspec-aad3a025 list-sessions` → `toy-beta: 1 windows`, nothing else. Neither server holds the other repo's session.

**Step 8 — the docket — PASS.** `pnpm proofspec docket` in root A shows the row: `toy-alpha  building  … tmux -L proofspec-4dec2301 attach-session -t toy-alpha` — the exact attach command naming the same server step 6 read, so the docket asks the same per-repo server by the same derivation rule. The row's `building` state also confirms the executor ran the INTENT.

**Step 9 — teardown — PASS.** Both `kill-server`s ran (`no server running` on both names afterwards) and both clones removed. Nothing of the run remains.

**Verdict: 9/9 pass.** The task's acceptance is met.
