# Acceptance report — `session-start-stderr` (re-run at HEAD 7cdf5c7)

First run at `e23dcca` failed step 6 — the healthy-path start exceeded tmux 3.6a's
command-size cap because the executor persona rode the `new-session` command line inline;
inherited pre-fix code, which this branch's merge of its base `subagent-extension`
(9decdcc, runner-file session handoff) resolved. Re-run after the merge: 7/7 pass.

## 1 — Suite (`pnpm test`) — PASS
93 files, 619 tests, all green. New scenario present and passing — "A session start that
fails throws an error carrying tmux's own stderr" (`tests/schedule/session.test.ts:100`);
existing sibling unchanged — "A worktree creation that fails throws an error carrying
git's own stderr" (`tests/schedule/session.test.ts:82`).

## 2 — Typecheck — PASS
`pnpm typecheck` clean, exit 0.

## 3 — spec:write / spec:check — PASS
`spec:write` → "nothing to write". `spec:check` → exit 0, no drift.

## 4 — Scratch queue root, two toy TASKs — PASS
Clone of the worktree at `7cdf5c7`, `pnpm install`, `main` created, `scratch/toy-start`
and `scratch/toy-control` each carrying one trivial `NOTES.md` commit, both dispatch dirs
holding `MANIFEST` / `INTENT` / `state=queued`.

Narrative slips in the script, worked around and judged by the steps' standards:
- The clone must stay on its initial checkout (`session-start-stderr`) for steps 5–6;
  any state resolving the queue root to `main` runs `origin/main`'s code, which predates
  the branch's fix (observed: the bare `exited with code 1` summary from main's
  `runOrThrow`).
- Queued TASKs sort alphabetically, so `toy-control` dispatches first — the script's
  step 5/6 narratives have the two names swapped.

## 5 — Broken socket, dispatch — PASS
`TMUX_TMPDIR` pointing at a directory holding a regular file `tmux-<uid>`,
`PROOFSPEC_TMUX_SOCKET=stderr-acc-broken pnpm proofspec schedule`: the run fails at the
start, and the thrown message carries tmux's own stderr —
`… : <scratch>/.proofspec/acc-sockets/tmux-501 is not a directory` — tmux's own words
about the socket it could not create, not a bare exit-code summary. (HEAD's `runOrThrow`
at `src/cli/session.ts:528`: stderr piped, `close` not `exit`, `commandLine + cause`.)

## 6 — Healthy socket, control start — PASS
Obstruction cleared, `PROOFSPEC_TMUX_SOCKET=stderr-acc-ok`, dispatch again: the pass
reports the LEASE-held TASK blocked (the two-minute grace from step 5) and dispatches the
other. `tmux -L stderr-acc-ok list-sessions` shows the session standing; `list-panes`
shows the pane started via the runner file and running the harness (`node`, pi). The
healthy path starts a session exactly as before.

## 7 — Teardown — PASS
`kill-server` exit 0; `~/scratch/stderr-root` removed. Nothing of the run remains.

**Verdict: 7/7 pass.**
