# Acceptance report — settle-pass-runs

Script: `/Users/yang/Projects/proofspec/.proofspec/dispatch/settle-pass-runs/acceptance.md`
Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/settle-pass-runs`

Pre-flight: git 2.50.1, node v24.15.0, pnpm 11.13.1, tmux 3.6a all on PATH. Every step was
run in order in one shell session (a sourced env file carried `CHECKOUT`, `STUB`, `SCRATCH`,
`PATH`, and the `PROOFSPEC_*` variables between commands). Every tmux command used `-L
proofspec-accept-settle-pass-runs`. Nothing touched audan-workspace, this repo's own queue,
or the user's own tmux server. Cleanup ran whatever the outcome.

**Result: 14/14 steps PASS.**

## Steps

### Step 1 — Point at the checkout, build it — PASS
Commands: `cd "$CHECKOUT" && pnpm install && pnpm build`; `ls dist/cli/main.js dist/mcp/core.js`.
Evidence: install ("Already up to date") and build both exit 0; `ls` lists
`…/dist/cli/main.js` and `…/dist/mcp/core.js`.

### Step 2 — Make the stand-in harness — PASS
Evidence: `command -v pi` prints `/tmp/proofspec-accept-stub.Bt9U9I/bin/pi`. The stub is
`+x`, appends `started $PROOFSPEC_TASK` to `$STUB/started.txt`, then `exec sleep 300`.

### Step 3 — A session on the throwaway server finds the stand-in — PASS
Evidence: `cat "$STUB/probe.txt"` prints `/tmp/proofspec-accept-stub.Bt9U9I/bin/pi`. Not a
real `pi`, so proceeding started no real agent.

### Step 4 — Scratch repo shaped like a consumer's — PASS
Evidence: root commit `ac1281c base` lands on `main`; `node -e` prints `no proofspec
script`; `node_modules/proofspec` is a symlink to
`…/worktrees/settle-pass-runs`; `pnpm --version` prints `11.13.1`; `.pi/agents/executor.md`
holds the placeholder persona.

### Step 5 — Old command form fails here — PASS
Command: `pnpm --dir "$SCRATCH" proofspec docket; echo "exit $?"`.
Evidence: `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command failed with EACCES: … proofspec
docket` / `spawn … EACCES`, `exit 1`.

### Step 6 — Queue two TASKs — PASS
Evidence: `git worktree add` reports `HEAD is now at cdc5768 accept-first: edit` (worktree at
`.proofspec/worktrees/accept-first`); `ls .proofspec/dispatch/accept-second/` prints
`MANIFEST` and `state` only (no `LEASE`); `ls .proofspec/schedule/settle-pass.log` prints
`No such file or directory`.

### Step 7 — Settle the first TASK via the tool core — PASS
Evidence: with `PROOFSPEC_QUEUE_ROOT=$SCRATCH`, `PROOFSPEC_TASK=accept-first`, run from
inside the worktree being settled, the command prints exactly `{"ok":true,"task":"accept-first"}`
— no `finding`.

### Step 8 — Held TASK started by the fired pass — PASS
Evidence (after `sleep 5`, no hand-run `schedule`): `accept-first`'s state prints `merged`;
`ls .proofspec/dispatch/accept-second/` now shows `LEASE`, `MANIFEST`, `state`;
`started.txt` holds `started accept-second`; `tmux … has-session -t accept-second` succeeds
and prints `accept-second live`.

### Step 9 — Log has the pass under its own header — PASS
Evidence: `.proofspec/schedule/settle-pass.log` exists; first line
`--- 2026-10-07T14:37:44.246Z settle accept-first ---`, 17 s before `date -u`
(`Wed Oct 7 14:38:01 UTC 2026`); the line after it is the pass's answer
`started accept-second`.

### Step 10 — Next pass made to fail, settle again — PASS
Evidence: after building `work/accept-third` (merged) and `work/accept-fourth`, adding both
dispatch entries, adding the `accept-third` worktree, and moving the persona to
`$STUB/executor.md.aside`, the settle prints `{"ok":true,"task":"accept-third"}` — ok
because the pass did start.

### Step 11 — Failed pass left its reason in the log — PASS
Evidence: the log's first two lines are byte-identical to Step 9's output (appended, not
overwritten). Below them: `--- 2026-10-07T14:38:13.713Z settle accept-third ---` (10 s
before `date -u`'s 14:38:23), then the pass's own error:
`Error: ENOENT: no such file or directory, open '/private/tmp/proofspec-accept.HWD1zC/.pi/agents/executor.md'`
with stack through `executorSystemPrompt`/`tmuxStartSession`/`schedule`. `grep -c
accept-fourth "$STUB/started.txt"` prints `0` (grep exits 1 on zero matches; the count is
what the standard names).

### Step 12 — Hooks use the explicit exec form — PASS
Evidence: exactly four `pnpm --dir` lines across the four hooks:
- `.githooks/post-merge:26`: `nohup pnpm --dir "$REPO_ROOT" exec proofspec schedule …`
- `.githooks/post-commit:41`: `nohup pnpm --dir "$REPO_ROOT" exec proofspec schedule …`
- `.githooks/pre-merge-commit:38`: `pnpm --dir "$ROOT" exec proofspec touched …`
- `.githooks/pre-push:40`: `pnpm --dir "$ROOT" exec proofspec touched …`

All four include `exec`; none runs `pnpm --dir "…" proofspec` bare.

### Step 13 — Checkout's own gates — PASS
Evidence: `pnpm test` — 97 files, 664 tests, all passed (the "judge: could not run" lines
are expected output from tests exercising misbehaving stand-in judges); `pnpm typecheck`
(tsc) clean; `pnpm spec:check` completes; the chained command exits 0.

### Step 14 — Clean up — PASS
Evidence: `tmux -L proofspec-accept-settle-pass-runs ls` → `no server running on
/private/tmp/tmux-501/proofspec-accept-settle-pass-runs`; `ls` of both scratch folders →
`No such file or directory`. Nothing of the drive is left on the machine.

## Cautions honored

- No command touched `/Users/yang/Projects/audan-workspace`.
- Every `settle_task`/schedule effect ran with `PROOFSPEC_QUEUE_ROOT` pointed at the scratch
  repo; this repo's own queue was never written.
- Every tmux command used `-L proofspec-accept-settle-pass-runs`; the user's own tmux server
  was never contacted.
- The stand-in `pi` was the only `pi` any session resolved (Step 3 proved it before any
  session was started).
