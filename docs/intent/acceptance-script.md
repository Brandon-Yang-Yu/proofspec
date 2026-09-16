# acceptance-script — every TASK gets an end-to-end check before `mergeable`

## The problem

An executor runs a TASK unattended and reports `mergeable` once every gate the branch
touches is clean. Every gate it has checks a part: tests, code review, spec consistency.
None of them drives the TASK's whole outcome end-to-end, from outside, the way a person
would check that the built thing works. A TASK can pass every part and still be an
outcome that does not run.

Such a check needs steps written for this one TASK: what to do, and the standard that
makes each step pass. The steps raise two questions of their own:

- **They must not be tracked in git.** They are written once, for one TASK, and are worth
  nothing after it merges.
- **The check's record must outlive the queue entry.** A queue entry is pruned once
  nothing still names it (docs/design.md §39). How a TASK was checked has to stay
  readable after that.

## The change

1. **Every TASK gets an acceptance script when its outcome can be driven end-to-end.**
   The investigator judges this during the investigation. When the outcome is drivable, a
   script is drafted for it. When it is not, the investigation says so plainly and skips.
   A TASK with no script simply does not have this gate; a missing script is never a
   failure.

2. **The script lives in the TASK's queue directory, untracked.** Its home is
   `.proofspec/dispatch/<task>/acceptance.md` in the main checkout. The queue machinery
   reads only that directory's `MANIFEST`, `state`, `LEASE`, and `heartbeat` files, so the
   script is invisible to it. `enqueue` refuses only a `MANIFEST` that already exists, so
   a script already sitting in the directory stops nothing. The script is written before
   `enqueue_task` is called.

3. **The intent writer drafts the script, in the same pass as the intent doc.** The format
   is plain: numbered steps, each saying what to do and naming the standard that makes
   the step pass. The investigator presents the drafted script to the human in the same
   disposition conversation as the rest, before `enqueue_task`. The human judges it
   there, like the prose.

4. **The executor gains a gate in front of `mergeable`.** Before reporting `mergeable`,
   the executor spawns a fresh **acceptance checker** subagent — a new persona,
   `.pi/agents/acceptance-checker.md` — and hands it two things: the script's path and
   the worktree root. The path is `$PROOFSPEC_QUEUE_ROOT/$PROOFSPEC_TASK/acceptance.md`,
   from the two environment variables `startSession` already hands the executor session
   (`specs/schedule.md`). The checker runs every step for real, with bash, and records
   evidence per step: the command it ran and what it observed. It reports pass or fail
   per step. It never edits code, never edits the script, never merges.

5. **A failed step is a finding, not a verdict.** The executor treats it like a review
   finding: fix the work, then rerun the checker. The one exception stays the one
   exception. A script proven wrong — a step whose judged standard cannot be right —
   parks the TASK with `report_task_state` and `blocked-on-question`
   (`specs/progress.md`).

6. **The report lives in git history, never in the tree.** The checker's report embeds
   the script's steps as executed and the evidence for each. The executor commits the
   report to the TASK's branch, then removes it in a follow-up commit before merging.
   The final tree never carries the report; the branch's history keeps it. After the
   queue entry is pruned, how the TASK was checked stays readable in that history.

7. **No spec moves.** `specs/progress.md`'s "mergeable once every gate is clean" takes
   the new gate in as it stands. The existing "future acceptance check" mentions — one
   in `specs/schedule.md`, one in `src/cli/session.ts` — stay untouched: both describe
   running the bare CLI against a real tmux, which is still future work. The glossary
   gains no TERM.

## The build, after hand-off

- `.pi/agents/investigator.md` — rewritten: judge end-to-end drivability; the intent
  writer drafts the script; present it in the disposition review; write it to the queue
  path before `enqueue_task`.
- `.pi/agents/intent-writer.md` — rewritten: the script joins its charter, with the
  plain numbered format.
- `.pi/agents/executor.md` — rewritten: the gate in front of `mergeable`, the
  failed-step handling, the report's commit-then-remove.
- `.pi/agents/acceptance-checker.md` — new.
- `docs/design.md` — a section recording the mechanism, and how it connects to the two
  existing "future acceptance check" mentions named above.

This TASK changes no code and no test. The suite stays green throughout, and the
tests-red round is empty.

## Acceptance — this TASK is checked by its own mechanism

This TASK's own acceptance script sits at
`.proofspec/dispatch/acceptance-script/acceptance.md` in the main checkout, untracked.
The executor runs it exactly the way the new gate prescribes: spawn the acceptance
checker persona, hand it the script's path and the worktree root, and let it run every
step for real.

The script checks that all four persona files landed — `acceptance-checker.md` new, the
other three rewritten — that `executor.md` names the acceptance gate before `mergeable`,
that `docs/design.md` records the mechanism, and that no file under `specs/` moved. Its
last step records that this very run came through the checker persona in this worktree:
the trial run of the mechanism and the real check on this TASK are the same run.

## Done means

- The four persona files stand as above, and the checker's file names its inputs, its
  acts, its report, and its refusals.
- `docs/design.md` records the mechanism and its connection to the two existing mentions.
- No file under `specs/` changed on this branch; `pnpm test` green.
- The checker ran every step of this TASK's script and every step passed.
- The report is in the branch's history and absent from the final tree; the docket
  reports this TASK mergeable.
