# Acceptance report — `per-repo-defaults`

Run by a fresh acceptance-checker against
`.proofspec/dispatch/per-repo-defaults/acceptance.md`.
Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/per-repo-defaults` @ `e9e9995` (clean).
This file is dropped before merge; the branch's history keeps it.

## Step 1 — `pnpm test` — **PASS**
- Command: `pnpm test` (worktree)
- Evidence: `Test Files 93 passed (93) / Tests 618 passed (618)`, duration 21s. The
  rewritten scenarios are present in the specs: `specs/schedule.md:214` (socket
  "`proofspec-` followed by the first 8 hex" of the queue root's SHA-256),
  `specs/cli.md:431-457` (derived serve port + fail-fast collision, →
  `tests/cli/docket-serve.test.ts`).

## Step 2 — `spec:write` then `spec:check` — **PASS**
- Evidence: `spec:write` → `nothing to write` (exit 0); `spec:check` → exit 0, only an
  informational term note (`MANIFEST`…), no drift.

## Step 3 — clone twice, install both — **PASS**
- Both clones at `e9e9995`. `pnpm install` in both: `Done in 2.7s`, exit 0 each.

## Step 4 — both dockets serve at once — **PASS**
- Repo A: `serving the docket at http://localhost:5013/`; repo B:
  `serving the docket at http://localhost:4652/`. No `--port` given anywhere.
- `curl -s http://127.0.0.1:<port>/docket` answered both with `{"rows":[],...}` JSON.
- Ports 5013 and 4652: different, both within [4567, 5566].
- Derivation verified from first principles (`src/cli/digest.ts`: SHA-256 of the
  repo-root path; port = 4567 + whole-digest mod 1000):
  - `sha256("/Users/yang/scratch/per-repo-a")` → socket `proofspec-51d5cc46`, port **5013** ✓
  - `sha256("/Users/yang/scratch/per-repo-b")` → socket `proofspec-3310ae0e`, port **4652** ✓

## Step 5 — enqueue `demo` in both — **PASS**
- Both repos carry `.proofspec/dispatch/demo/{MANIFEST,INTENT,state}` with the exact
  scripted contents; `state` = `queued`; `demo-work` branch created in both.

## Step 6 — dispatch in A, read its docket — **PASS**
- `pnpm proofspec schedule` → `started demo`.
- A's docket row: `demo building … tmux -L proofspec-51d5cc46 attach-session -t demo` —
  derived server `proofspec-` + 8 hex (`51d5cc46`, = first 8 of A's queue-root SHA-256),
  not the user's default server and not bare `proofspec` (a bare `proofspec` socket
  exists on this machine from other work — the attach command does not name it).
- `tmux -L proofspec-51d5cc46 ls` → `demo: 1 windows (created … 12:10:50)` — session live
  on the derived server.

## Step 7 — dispatch in B, both survive — **PASS**
- B: `started demo`. B's docket row attach: `tmux -L proofspec-3310ae0e attach-session
  -t demo` — B's own derived server, different name from A's.
- Both same-named `demo` sessions alive at once: `tmux -L proofspec-51d5cc46 ls` →
  `demo (12:10:50)`; `tmux -L proofspec-3310ae0e ls` → `demo (12:12:11)`. A's row still
  shows its live session after B's pass — the per-repo servers are exactly what kept
  B's same-named start from killing A's.
- Observation (not the step's standard): B's row stayed `queued` (state label) while its
  session was live and attachable; A's showed `building`. The step's standard — B's
  session on B's derived server, A's row live after B's pass — is met either way.

## Step 8 — collision fails fast — **PASS**
- Second `pnpm proofspec docket --serve` in repo B (first still holding 4652): exits
  immediately, code 2, with `port 4652 is already in use (name another with --port)` —
  names the port and `--port`, no silent fallback (first server still `LISTEN` on
  127.0.0.1:4652 after).

## Step 9 — tear down — **PASS**
- Serve processes stopped (`pgrep "docket --serve"` → none; ports 5013/4652 no longer
  listening).
- `tmux -L proofspec-51d5cc46 kill-server` and `tmux -L proofspec-3310ae0e kill-server`
  both exit 0; follow-up `ls` → "no server running"; stale socket files removed from
  `/tmp/tmux-501/`.
- `~/scratch/per-repo-a` and `~/scratch/per-repo-b` removed; no processes left from
  either. (Pre-existing `~/scratch/phase-history-*` dirs and the user's own `pi`
  sessions on the default server predate this run and are untouched.)

## Step 10 — **AWAITING-HUMAN**
The last standard is the human's own eyes: two repos served (5013 / 4652), dispatched
(`proofspec-51d5cc46` / `proofspec-3310ae0e`), and failed fast on collision, with
nothing configured and nothing shared. Not pass/fail for the checker — awaiting the
human's yes.

**Result: steps 1–9 pass; step 10 awaiting-human.**
