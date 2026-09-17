# Acceptance report — settle-task

Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/settle-task` (branch `settle-task`, clean). Per the dispatch note, every `-e` pin below points at the worktree's own `.pi/extensions/progress.ts` — `<main>`'s copy carries the tool only after this TASK merges. All scratch state lived under `/tmp/settle-accept/step{1,2,3}`; every command ran with `PROOFSPEC_TMUX_SOCKET=scratchsock`; nothing touched the real queue, the real worktrees, or the `proofspec` production socket (one read-only peek at the end, noted under step 4).

## Step 1 — the backstop path — **PASS**

Ran, as written:

```
cd /tmp/settle-accept/step1/repo && PROOFSPEC_TMUX_SOCKET=scratchsock \
  node --experimental-transform-types <worktree>/src/cli/main.ts schedule
```

Output: `merged task-a (branch landed in main)`, exit 0.

Passes-when, all observed:
- `task-a/state` reads `merged` — confirmed (`cat` → `merged`).
- Worktree path `.proofspec/worktrees/task-a` gone — `ls -d` → "No such file or directory"; `git worktree list` shows only the scratch main worktree (prune cleared the registration).
- `tmux -L scratchsock has-session -t task-a` fails — checked 3 s after the pass (past the reaper's 2 s delay): "no server running on /private/tmp/tmux-501/scratchsock".
- `task-b` untouched — state still `building`; entry (`MANIFEST`, `state`) still present.

## Step 2 — the tool path — **PASS**

Fresh copy of the same scratch state; killed the dummy session; started the one-shot pi inside the doomed session:

```
tmux -L scratchsock new-session -d -s task-a -c $SCRATCH/repo/.proofspec/worktrees/task-a \
  "env PROOFSPEC_QUEUE_ROOT=$SCRATCH/repo PROOFSPEC_TASK=task-a PATH=$PATH \
   pi -p --no-extensions --approve -e <worktree>/.pi/extensions/progress.ts \
   'Call the settle_task tool now.' > $SCRATCH/tool-answer.txt 2>&1"
```

Passes-when, all observed:
- `$SCRATCH/tool-answer.txt` holds pi's reply carrying the tool's result — the file (136 bytes, complete) reads: *"Done — TASK task-a settled: its state was rewritten to merged, the worktree was removed, and a delayed reaper will kill this session."* The answer got out before the host session died (session gone by ~10 s, reply already flushed to the file outside the worktree).
- `task-a/state` reads `merged` — confirmed.
- Worktree path gone — confirmed.
- `has-session -t task-a` fails — "no server running".

## Step 3 — the refusal path — **PASS**

Fresh scratch on the never-merged `task-c` (state `mergeable`, worktree + dummy session standing; `git merge-base --is-ancestor task-c main` verified failing beforehand). Ran the same one-shot call from the shell, cwd in the TASK's own worktree:

```
env PROOFSPEC_QUEUE_ROOT=$SCRATCH/repo PROOFSPEC_TASK=task-c \
  pi -p --no-extensions --approve -e <worktree>/.pi/extensions/progress.ts \
  'Call the settle_task tool now.'
```

Passes-when, all observed:
- The reply carries the tool's refusal naming why — the reply quotes the tool's text verbatim: *"Could not settle: TASK task-c cannot be settled: its branch task-c has not landed in main"*.
- `task-c/state` still `mergeable` — confirmed on disk after the run.
- Worktree path still exists — confirmed, still in `git worktree list`.
- `has-session -t task-c` still succeeds — confirmed (dummy session alive; nothing was torn down).

## Step 4 — the dogfood — **NOT RUNNABLE BY THE CHECKER (by design)**

The step says "Do: nothing to run here"; the passes-when is explicitly "only the human's own eyes," observable after this TASK merges. Nothing for me to execute, and the post-merge state cannot be checked from inside the pre-merge branch. For the human's baseline I took one read-only peek before cleaning up: the production `proofspec` socket currently holds session `settle-task` (attached), and the real entry `/Users/yang/Projects/proofspec/.proofspec/dispatch/settle-task/state` reads `building`. After merge it should read `merged` and the session should be gone.

## Verdict

Steps 1–3: **pass** with the evidence above. Step 4: pending the human's post-merge observation, per the script's own terms. Scratch tmux socket torn down; scratch dirs left at `/tmp/settle-accept/` for inspection.
