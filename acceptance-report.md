# Acceptance report — `socket-per-repo`

Worktree `/Users/yang/Projects/proofspec/.proofspec/worktrees/socket-per-repo`, branch clean, HEAD `c1af6f9` (`feat(cli): the default tmux socket derives from the queue root`).

## 1. Run the suite — PASS
**As executed:** `pnpm test` → `Test Files 93 passed (93)`, `Tests 618 passed (618)`.
The named scenarios, verified in `tests/schedule/session.test.ts` and run individually (`pnpm vitest run tests/schedule/session.test.ts -t socket` → 3 passed):
- New: *"The default socket is derived from the queue root, so two repos never share a server"* — proves the `proofspec-<short hash>` shape, name stable per root across builds and TASKs, distinct across roots — including `/x/repo` vs `/y/repo` (the whole absolute path, not the basename).
- Existing, unchanged: *"The tmux commands run against a dedicated server, never the user's default or any other named one"* and *"PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target"* — still prove exactly what their names say.

## 2. `pnpm typecheck` — PASS
` tsc -p tsconfig.json`, exit 0, no output.

## 3. `spec:write` then `spec:check` — PASS
`write` → `nothing to write` (requirements and scenario blocks already agree); `check` → exit 0, one informational vocabulary note (`Term MANIFEST…`), no drift.

## 4. Build two scratch queue roots — PASS (after one self-inflicted repair)
Cloned the worktree into `~/scratch/socket-root-a` and `~/scratch/socket-root-b`, `pnpm install` in each (both exit 0). Each root: branch `scratch/toy-alpha` / `scratch/toy-beta` with one trivial `NOTES.md` commit, and `.proofspec/dispatch/<task>/` holding `MANIFEST` (`{"intentRef":"INTENT","branch":"scratch/toy-…","base":{"kind":"main"}}`), `INTENT` ("Report `building`, then stop — this TASK builds nothing."), `state` = `queued`.

**Repair (setup, not product):** following the recipe's `git checkout -b` literally left each clone's HEAD on the task branch, so `schedule` failed at worktree creation (`'scratch/toy-alpha' is already used by worktree at …`) and left a LEASE. I moved each clone's HEAD back to `socket-per-repo` and removed the stale LEASE, restoring the entries to exactly the three files + `queued`.

## 5. Dispatch both, no `PROOFSPEC_TMUX_SOCKET` — PASS
Verified the env unset in the shell first. `cd ~/scratch/socket-root-a && pnpm proofspec schedule` → `started toy-alpha` (exit 0); same in root B → `started toy-beta` (exit 0). Each dispatch started its TASK's session per the startSession requirement.

## 6. Read the derived names — PASS
`TMUX_TMPDIR` unset; `ls /tmp/tmux-$(id -u)/`. Two new `proofspec-<hash>` sockets appeared at the dispatch times: `proofspec-4dec2301` and `proofspec-aad3a025`. Independently computed the expected names from the implementation (`sha256` over the canonical queue root, first 8 hex, `proofspec-` prefix): `/Users/yang/scratch/socket-root-a` → `proofspec-4dec2301`, `/Users/yang/scratch/socket-root-b` → `proofspec-aad3a025` — exact match. Two sockets, one per clone, names differ because the absolute paths differ.

## 7. Ask each server — PASS
`tmux -L proofspec-4dec2301 list-sessions` → `toy-alpha: 1 windows` and nothing else; `tmux -L proofspec-aad3a025 list-sessions` → `toy-beta: 1 windows` and nothing else. Two repos, two servers, no cross-holding.

## 8. Ask the docket — PASS
`cd ~/scratch/socket-root-a && pnpm proofspec docket` → the `toy-alpha` row (state `building`) ends in `tmux -L proofspec-4dec2301 attach-session -t toy-alpha` — the exact attach command naming the same server step 6 read. (The executor had also already reported `building` per its INTENT.)

## 9. Teardown — PASS
`tmux -L proofspec-4dec2301 kill-server`, `tmux -L proofspec-aad3a025 kill-server` (both then answered `no server running`; no matching processes), `rm -rf ~/scratch/socket-root-a ~/scratch/socket-root-b`. tmux left two dead socket files behind; removed them too. Verified: clones gone, derived sockets gone.

---

**Verdict: 9/9 steps pass.** The only friction was my own literal reading of step 4's `git checkout -b` (leaving HEAD on the task branch blocks worktree creation); after repairing the scratch setup, every product standard held — including the core claim, proven both in-suite and live: the default socket derives from the queue root's absolute path, so two repos on one machine never share a server, with the docket and scheduler naming the same per-repo server by the same rule.
