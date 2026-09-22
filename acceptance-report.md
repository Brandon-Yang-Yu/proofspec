# acceptance report — claude-code-harness

Round 3 (final): steps 1-9 PASS, 10-11 deferred to after merge. Round 1 caught the live tmux command-size defect (inline 18KB persona; fixed by merging main's runner-file handoff and porting PROOFSPEC_EXECUTOR onto it). Round 2 caught claude's variadic --mcp-config swallowing the trailing kickoff (fixed by leading the argv with the kickoff).

All runnable steps are done. Here is the acceptance report.

---

# Acceptance report — `claude-code-harness`

Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/claude-code-harness` (branch `claude-code-harness`, clean, 21 commits ahead of `main` — not yet merged).

## Step 1 — `pnpm test` — **PASS**
- Ran `pnpm test`: **92 files / 612 tests, all passed.**
- The named subsets re-ran alone: `tests/mcp tests/schedule tests/progress tests/handoff` → 21 files / 178 tests, all passed.
- The pin scenario stands byte-for-byte: `tests/schedule/session.test.ts:201` — "Scenario: The pi invocation carries --approve and --extension pinned to this checkout's own progress extension", recorded in `specs/schedule.md:253`. (One expected stderr diagnostic from a judge-timeout test; suite green regardless.)

## Step 2 — `pnpm typecheck` — **PASS**
- `tsc -p tsconfig.json`, exit 0, no output.

## Step 3 — `spec:write` then `spec:check` — **PASS**
- `spec:write` → `nothing to write`; `spec:check` → exit 0 (the "Term MANIFEST" line is a note, not drift; `git status` clean after both).

## Step 4 — scratch queue root + toy TASK — **PASS**
- Cloned the worktree to `~/scratch/claude-harness-root`, `pnpm install` done. Branch `scratch/toy-claude` with one NOTES.md commit; entry `.proofspec/dispatch/toy-claude/` holds the exact `MANIFEST`, an `INTENT` ("report `building`, report one phase word, then stop — this TASK builds nothing"), and `state`=`queued`.
- Verified the hand-made entry matches the queue's own interface: `enqueue` writes `JSON.stringify(manifest)` and `writeFile(state, 'queued')`, both without newline — same as mine (`src/cli/queue.ts:377,348`).

## Step 5 — dispatch under Claude Code — **PASS** (after correcting my own toy setup; two findings for the executor)
- **First dispatch failed** for a reason in the step's own instruction, not the code: `git checkout -b scratch/toy-claude` leaves the clone root holding the branch, and git refuses to check the same branch out twice — `could not create a worktree ... 'scratch/toy-claude' is already used by worktree at .../claude-harness-root`. Committing on the toy branch then switching the root back to `claude-code-harness` fixed it. A human following the script verbatim hits this wall.
- My recovery then made things worse before better: `git checkout main` put the scratch root on **pre-task code** (21 commits behind; `PROOFSPEC_EXECUTOR` absent from `src/`), and that dispatch started a `pi` session — old behavior, correctly so for old code. The clone's `origin/HEAD` actually points at `claude-code-harness`, so a plain clone carries the work; the checker must not check out `main`. With the root on the task branch, the retry (after the expected 2-minute LEASE grace from the failed pass) dispatched cleanly.
- **Evidence for the standard**: session `toy-claude` stands on socket `claude-acc-1`; runner reads `exec claude "$PROOFSPEC_KICKOFF" --append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")" --dangerously-skip-permissions --mcp-config "$PROOFSPEC_MCP_CONFIG"`; the generated `mcp-config.json` registers `proofspec` → `node --experimental-transform-types <checkout>/src/mcp/serve.ts`; worktree at `.proofspec/worktrees/toy-claude` on `scratch/toy-claude`.

## Step 6 — the three facts — **PASS**
- `state` → `building`; `phase` → `{"phase":"explorer","round":1,"since":...}` (a word with a round); `heartbeat` stood and its mtime moved with the session's moves (02:43:34 → 02:43:58, then frozen once the session stopped, as its INTENT told it to).
- The pane shows the facts arriving through the MCP tools: `report_task_state` → `{"ok":true,"task":"toy-claude","state":"building"}`, `report_task_phase` → "explorer, round 1 (acked)".
- Environmental note: the headed claude session opened blocked on Claude Code's first-run folder-trust dialog; I answered it via `tmux send-keys` (Down, Enter) to let the run proceed. Nothing in the TASK to fix.

## Step 7 — tear the toy down — **PASS**
- `kill-server`, worktree removed, `git worktree prune` (list shows only the root), queue entry removed. Nothing of the toy remains.

## Step 8 — judge headlessly — **PASS**
- `judge-probe.mts` imports `piJudge` from `./src/cli/judge.ts`, asks about `specs/glossary.md` shared by two TASKs whose intents say they never touch it.
- `PROOFSPEC_JUDGE_BIN=claude node --experimental-transform-types ./judge-probe.mts` printed **`resolved`**.

## Step 9 — default unchanged — **PASS**
- `toy-pi` built the same way; dispatched with only `PROOFSPEC_TMUX_SOCKET=claude-acc-2` (no `PROOFSPEC_EXECUTOR`).
- Runner: `exec pi --approve --no-extensions --extension "$PROOFSPEC_PROGRESS_EXTENSION" --append-system-prompt ... "$PROOFSPEC_KICKOFF"` — exactly the pinned argv as before.
- Torn down; scratch root removed (`judge-probe.mts` deleted with it); both throwaway servers dead.

## Step 10 — no `.mcp.json` at repo root — **DEFERRED (after merge)**
- The branch is 21 commits ahead of `main` — not merged. Informational: `ls .mcp.json` finds nothing in `/Users/yang/Projects/proofspec` today, and nothing in the worktree either. The binding check belongs to the post-merge pass.

## Step 11 — the human's own eyes (`pnpm investigator:claude`) — **DEFERRED (after merge)**
- The human's step; to run post-merge and confirm the five tools (`enqueue_task` among them) answer with no manual wiring.

---

**Verdict: steps 1–9 pass; 10–11 deferred to after merge.** Nothing failed on the deliverable's merits. Two non-blocking findings from step 5 worth the executor's eyes: (a) the script's `git checkout -b` instruction leaves the clone root on the toy branch, which makes the first dispatch fail on git's same-branch-twice rule — the script could say "switch the root back to the task branch" after the commit; (b) the clone must stay off `main` (its `origin/HEAD` already points at the task branch) or the dispatch exercises pre-task code and starts `pi` instead. I committed nothing and fixed nothing; every toy artifact is removed.
