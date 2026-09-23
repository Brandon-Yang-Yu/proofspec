# acceptance report — `block-not-stack`

Run from `/Users/yang/Projects/proofspec/.proofspec/worktrees/block-not-stack`
(steps 1–2), the scratch clone `~/scratch/block-root` (steps 3–8, since removed),
and the main checkout `/Users/yang/Projects/proofspec` (step 9, read-only).
`pnpm`, `tmux`, and `pi` were on PATH. Steps 3–8 built toy TASKs on a scratch
clone, ran on the throwaway socket `block-acc` under `.proofspec/acc-sockets`,
and step 10 removed all of it.

Verdict: **steps 1–10 pass; step 11 is pending-human.**

## Step 1 — `pnpm test` — PASS

Command: `pnpm test` in the worktree root.

Observed: 93 test files passed (93), 606 tests passed (606), zero failures.
`specs/inflight.md`, `specs/docket.md`, and `specs/schedule.md` are all present
on the branch, so the rewritten inflight scenarios and the new flat-row docket
scenarios ran as part of the suite.

## Step 2 — `pnpm spec:write`, then `pnpm spec:check` — PASS

Observed: `spec:write` printed `nothing to write` (exit 0) — the scenario
blocks and the requirements agree. `spec:check` exited 0. Its one output line
(`Term MANIFEST: its definition spells TASK in its everyday form…`) is an
advice-level finding from the vocabulary guard, not drift: the exit-code table
in `src/cli/render.ts` (`exitCodeOf`) makes `check` exit non-zero only on
`status === 'fail'`, and the exit was 0.

## Step 3 — scratch queue root — PASS

Commands: `git clone <worktree> ~/scratch/block-root`, then `pnpm install`,
then `git checkout main`.

Observed: clone clean; `pnpm install` exited 0 (`Done in 1.8s`); local `main`
checked out and standing for the toys to fork from.

## Step 4 — two toy TASKs — PASS

Commands: exactly the script's branch builds (`scratch/alpha`, `scratch/beta`,
one trivial commit each on `specs/duo.md`), then `git checkout block-not-stack`,
then the script's hand-written queue entries.

Observed (greps on the files):

- `beta`'s MANIFEST carries `"blocked":{"task":"alpha","reason":"waits behind
  alpha for the acceptance run"}` — `blocked` answers once, `grep '"base"'`
  answers not at all (exit 1).
- `alpha`'s MANIFEST is `{"intentRef":"INTENT","branch":"scratch/alpha"}` —
  `grep blocked` answers not at all (exit 1). The absent shape.

## Step 5 — `pnpm proofspec inflight` — PASS

Observed (alpha+beta standing): beta's entry carries
`"blockedBy":{"task":"alpha","reason":"waits behind alpha for the acceptance
run"}` and `"problem":null`; alpha carries `"blockedBy":null`. Both write the
`duo` capability and `"relationships":[]` — the edge explains the share, no
relationship raises. Beta's branch was cut from `main` and never from alpha's,
and no ancestry problem fired — the exact case the old verification reported
as a broken claim.

## Step 6 — third TASK gamma — PASS

Observed: exactly one relationship —
`{"node":{"kind":"capability","name":"duo"},"tasks":["alpha","beta","gamma"]}` —
naming each TASK once. Alpha–beta's share stays explained by the edge (no
problem raised); gamma's share is explained by nothing, and that is the one
relationship that raises.

## Step 7 — docket serve — PASS

Command: `TMUX_TMPDIR="$PWD/.proofspec/acc-sockets" PROOFSPEC_TMUX_SOCKET=block-acc
pnpm proofspec docket --serve --port 4673`, run in the background (the script's
Ctrl-C is delivered as a kill in step 10), then `curl -s` on `/` and `/docket`.

Observed on the page (`http://127.0.0.1:4673/`):

- `tbody#rows` carries exactly three task rows: `alpha`, `gamma`, then the
  `Held` group heading, then `beta` — alpha's and gamma's rows stand before
  beta's, name order within the not-held group.
- beta's branch cell carries `<span class="waiting">blocked by alpha</span>`.
- Zero `<details` elements; no `N/M` fraction anywhere on the page.

Observed in the JSON (`/docket`): one row per queue entry (alpha, beta, gamma);
beta's row carries `"blocked":{"task":"alpha","reason":"waits behind alpha for
the acceptance run"}`; no row carries a `base` field.

(Side observation, outside the standard: the page's "rulings outstanding"
section names real TASKs — the clone carries the repo's tracked
`.proofspec/schedule/raised.jsonl` ledger, and outstanding rulings are read
from it. Queue rows themselves are exactly the three toys.)

## Step 8 — scheduling pass — PASS

Command: `TMUX_TMPDIR="$PWD/.proofspec/acc-sockets" PROOFSPEC_TMUX_SOCKET=block-acc
pnpm proofspec schedule`, then `tmux -L block-acc list-sessions`, then
`cat .proofspec/dispatch/beta/state`.

Observed: the pass printed `started alpha` / `started gamma`. `list-sessions`
shows exactly `alpha` and `gamma` on the throwaway socket, each with a headed
window (`node*`, 1 pane — the dispatch); no session named `beta`. Beta's state
file still reads `queued`; alpha's and gamma's read `building`. The pass held
the blocked TASK and dispatched the free ones.

## Step 9 — live queue migration, read-only — PASS against what stands

Commands: the script's greps in `/Users/yang/Projects/proofspec`, one grep for
`"blocked"` and one for `"base"` per named MANIFEST.

What stands on the live queue (`block-not-stack`, `dispatch-tool`,
`socket-per-repo`, `subagent-extension`):

- `per-repo-defaults`, `session-start-stderr`: no MANIFEST — the entries no
  longer exist on the queue. The script's three-name list is stale for these
  two; the run instructions and the PLAN record this, and the check verifies
  what stands.
- `socket-per-repo`: `grep '"blocked"'` answers once —
  `"blocked": {"task": "subagent-extension", "reason": "Its rewrites land in
  the startSession requirement claude-code-harness rewrote and
  subagent-extension re-pinned; drafting against the later of the two avoids a
  textual collision at merge"}`; `grep '"base"'` answers not at all.
- `subagent-extension`: `blocked` answers once, naming its recorded blocker
  `claude-code-harness` with its recorded reason verbatim (the entry cannot
  block on itself); no `base`.
- `block-not-stack`: carries no field at all — both greps answer not at all.
- Across the whole live queue, no MANIFEST carries `"base"`.

The migration's shape stands: `blocked` naming the recorded blocker with the
recorded reason verbatim, under the new field, with no `base` remaining.

## Step 10 — teardown — PASS

Commands: killed the serve process (the script's Ctrl-C), `tmux -L block-acc
kill-server`, `rm -rf ~/scratch/block-root`.

Observed: serve stopped and port 4673 closed (four other `docket --serve`
processes found by pgrep belong to other projects on other ports and predate
this run); tmux server on `block-acc` killed (exit 0); the scratch root
removed. The worktree itself is clean (`git status --short` empty).

## Step 11 — the human's own eyes — PENDING-HUMAN

The standard is the human seeing one block, no stack — the edge drawn from the
manifest with nothing verified in git, the flat docket naming its blockers,
the held TASK held and the free ones dispatched — and saying yes. This report
is the evidence; the saying-yes is not mine to give.
