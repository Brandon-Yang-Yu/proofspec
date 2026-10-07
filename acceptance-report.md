# Acceptance report — project-config

Run by a fresh acceptance checker against HEAD 94c4f46, under bash, with every inherited
`PROOFSPEC_*`, `TMUX` and `TMUX_PANE` unset and a throwaway tmux socket. The script is the
queue entry's `acceptance.md`, after its scaffolding and three passes-when checks were
corrected (persona and `tests/` placeholder committed by `newrepo`; steps 1 and 3 check the
`base` touched measures from; step 7 checks four started, one deferred, all still `queued`).

| Step | Result | Evidence |
|---|---|---|
| 1. `touched` measures from `baseBranch` | PASS | no file / exported variable / empty `baseBranch`: exit 2 naming `main`; `{"baseBranch":"develop"}`: exit 0, `base` = `git rev-parse develop` |
| 2. Invalid JSON fails naming the file | PASS | exit 2, message names `.proofspec/config.json` |
| 3. Worktree reads the main checkout's file | PASS | worktree copy names `main`; `touched` exit 0, `base` = tip of `develop` |
| 4. A pass settles into `baseBranch` | PASS | `merged landed (branch landed in develop)`, `pruned landed`; archived state `merged` |
| 5. `executor` picks the agent; no base branch handed down | PASS | `records/started` = `claude` only; `PROOFSPEC_QUEUE_ROOT`, `PROOFSPEC_TASK` set; `PROOFSPEC_BASE_BRANCH` unknown |
| 6. The TASK's executor record comes first | PASS | `records/started` = `pi` only |
| 7. Bad `executor` / `maxSessions` fall back | PASS | 4 `pi`, 0 `claude`; 4 sessions; started 4, deferred 1; all five `queued` |
| 8. `maxSessions` sets the bound | PASS | exported `PROOFSPEC_MAX_SESSIONS=4` ignored; 1 session; y, z deferred and `queued` |
| 9. `judgeBin` / `judgeTimeoutMs` | PASS | `judge-right` ran, `judge-wrong` did not; timed out at 2000ms; pass took 2.6s |
| 10. Green gates | PASS | `pnpm test` 97 files / 663 tests; `pnpm spec:check` exit 0 |

Observation, not a failed step: a judge stub killed at its timeout left its own `sleep`
child running; a judge program that spawns children could leave them behind.
