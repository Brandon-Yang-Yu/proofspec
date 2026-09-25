# Acceptance report — settle-pass-cwd (final pass)

Run by the acceptance-checker subagent against
`/Users/yang/Projects/proofspec/.proofspec/dispatch/settle-pass-cwd/acceptance.md`,
from this worktree's checkout. Verdict: **PASS — all 7 steps.**

Three runs were needed. The first two failures were defects in the script's
hand-built fixtures, not in the work: `echo mergeable > state` leaves a trailing
newline no queue writer ever produces (`writeState` writes bare words), and the
scratch repo had no `specs/` directory, without which a schedule pass over a
non-empty queue refuses to run. Both were fixed in the queue entry's script;
no code changed between runs.

## Steps

1. **checkout runs — PASS.** `pnpm install` → "Done", no error.
2. **scratch git repo — PASS.** Root commit `672f24d base` on `main`, with the
   `proofspec` script, the placeholder executor persona, and the empty `specs/`.
3. **queue two TASKs, worktree standing — PASS.** `git worktree add` prepared
   `.proofspec/worktrees/accept-first`; both entries stand with MANIFEST + bare
   state words.
4. **starting state — PASS.** `mergeable` / `queued`; `accept-second/` holds no
   `LEASE`.
5. **settle from inside the doomed worktree — PASS.** The scripted
   `node --eval` printed exactly `{"ok":true,"task":"accept-first"}`, with cwd
   the worktree the settle removes.
6. **the pass survived the teardown — PASS.** After `sleep 5`: `LEASE` present
   in `accept-second`'s entry; `accept-first` state reads `merged`;
   `.proofspec/worktrees/` holds only `accept-second` — the settle's fired pass
   ran standing in the queue root and dispatched the queued TASK.
7. **clean up — PASS.** Scratch removed, throwaway tmux server gone, real repo
   verified intact.

## Incident disclosure (repaired, no effect on verdicts)

The checker's first attempt at step 3 leaked into this worktree (a flawed
handoff of the scratch path). It repaired immediately: removed the bogus nested
worktree, restored the branch, deleted the fake branches and queue entries, and
verified the repair (worktree list, clean status). The executor re-verified
after the run: clean status, no `work/*` branches, expected worktree list, HEAD
at the branch tip.
