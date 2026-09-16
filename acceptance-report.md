All steps executed. Here is the report.

---

# Acceptance report — TASK `acceptance-script`

**Result: PASS on all 7 steps.** One wording observation on step 4 recorded below; it does not change the verdict.

## Step 1 — The checker persona exists and states its own contract — **PASS**

**Do:** read `.pi/agents/acceptance-checker.md`.
**Evidence:** `read .pi/agents/acceptance-checker.md` — file exists, 18 lines. Every required element is present, verbatim:
- Two inputs: *"The executor spawns you fresh for one check and hands you two things: the acceptance script's path and the worktree root."*
- Run for real, evidence per step: *"Run every step for real, with bash... record the evidence: the command you ran and what you observed."*
- Pass/fail report per step: *"Report pass or fail per step, embedding the script's steps as executed and the evidence for each."*
- Refusals: *"You never edit code, never edit the script, never merge."*

## Step 2 — The investigator persona carries the drafting duties — **PASS**

**Do:** read `.pi/agents/investigator.md`.
**Evidence:** `read .pi/agents/investigator.md` — the section "The TASK's acceptance script" carries every required clause:
- Judges drivability during the investigation: *"During the investigation, judge one more thing: can this TASK's outcome be driven end-to-end"*
- Drivable → drafted by the intent writer in the same pass: *"An outcome that can be driven end-to-end gets its script drafted by the intent writer, in the same pass as the intent doc."*
- Not drivable → said plainly and skipped: *"A TASK whose outcome cannot says so plainly and skips the script. A missing script is an absent gate, never a failure."*
- Presented in the disposition review: *"Present the drafted script to the human in the disposition review. The human judges it there, like the prose."*
- Written to its home before enqueue: *"The accepted script's home is `.proofspec/dispatch/<task>/acceptance.md` in the main checkout — untracked, written there before `enqueue_task` is called"* and, under the enqueue checklist, *"The accepted script is at its home before the call."*

## Step 3 — The intent writer's charter includes the script — **PASS**

**Do:** read `.pi/agents/intent-writer.md`.
**Evidence:** `read .pi/agents/intent-writer.md` —
- Scope names the script alongside the intent doc, twice: the description (*"Drafts the TASK's acceptance script, `.proofspec/dispatch/<task>/acceptance.md`... Drafts the TASK's intent doc"*) and the body: *"An **acceptance script**: `.proofspec/dispatch/<task>/acceptance.md`, drafted in the same pass as the intent doc."*
- Format stated: *"Numbered steps, each saying what to do and naming the standard that makes the step pass."*

## Step 4 — The executor gates `mergeable` on the check — **PASS**

**Do:** read `.pi/agents/executor.md`.
**Evidence:** `read .pi/agents/executor.md` — the section "The acceptance gate, in front of `mergeable`":
- Spawn + two inputs: *"Before reporting `mergeable`, spawn a fresh **acceptance checker** subagent (`.pi/agents/acceptance-checker.md`) and hand it two things: the acceptance script's path and this worktree's root."*
- Failed step = review finding: *"A failed step is handled like a review finding: fix the work, rerun the checker."*
- Wrong script parks the TASK: *"A script proven wrong — a step whose judged standard cannot be right — parks the TASK through `report_task_state` with `blocked-on-question`."*
- Commit-then-remove: *"Commit the checker's report to this branch, then remove it in a follow-up commit before merging. The final tree never carries it; the branch's history keeps it."*

**Observation (does not fail the step):** this script's step text writes the path as `$PROOFSPEC_QUEUE_ROOT/$PROOFSPEC_TASK/acceptance.md`; executor.md writes `$PROOFSPEC_QUEUE_ROOT/.proofspec/dispatch/$PROOFSPEC_TASK/acceptance.md`. I verified against the code which form denotes the real file: `src/cli/session.ts` (`sessionStartFor`: `queueRoot: cwd`, the main checkout root) and `src/cli/queue.ts` (`QUEUE_DIR = ['.proofspec','dispatch']`, appended inside `writeState`). So `PROOFSPEC_QUEUE_ROOT` is the checkout root, and executor.md's fuller form resolves to the exact script I hold — `/Users/yang/Projects/proofspec/.proofspec/dispatch/acceptance-script/acceptance.md`, confirmed present. The script's own expression is looser shorthand for the same file; executor.md states the mechanism correctly, so the step passes on substance. The executor may want to know the script's shorthand omits `.proofspec/dispatch`.

## Step 5 — The design record carries the mechanism — **PASS**

**Do:** read `docs/design.md`, find the section.
**Evidence:** `grep -n "acceptance" docs/design.md` located §58 at line 1495: *"## 58. The acceptance script — the end-to-end check in front of `mergeable`"*; read in full. Every required element present:
- Home: *"The script's home is `.proofspec/dispatch/<task>/acceptance.md` in the main checkout, untracked."*
- Before enqueue: *"The script is written before `enqueue_task` is called."*
- Writer drafts, human judges: *"gets its script drafted by the intent writer... in the same pass as the intent doc... The human judges the drafted script in the disposition review, like the prose."*
- Gate in front of `mergeable`: section title and *"Before reporting `mergeable`, the executor spawns a fresh acceptance checker."*
- Commit-then-remove: *"The checker's report is committed to the TASK's branch, then removed in a follow-up commit before merging."*
- The future mentions: *"Two existing 'future acceptance check' mentions stay future. One is in `specs/schedule.md`, in the `PROOFSPEC_TMUX_SOCKET` paragraph; the other in `src/cli/session.ts`, on the `tmuxSocket` comment. Both describe running the bare CLI against a real tmux binary. This mechanism does not touch them."*

Cross-checked on disk: both mentions exist (`specs/schedule.md:236`, `src/cli/session.ts:90`, inside the `tmuxSocket` comment) and neither file appears in this branch's diff (step 6) — they stayed future.

## Step 6 — No spec moved — **PASS**

**Do:** resolve the base through the queue; diff; list changed files.
**Evidence:** `cat /Users/yang/Projects/proofspec/.proofspec/dispatch/acceptance-script/MANIFEST` → base is `{"kind":"task","task":"writer-drafts-intent"}`. The base TASK's own queue entry is no longer in dispatch (`ls .proofspec/dispatch/` shows only `acceptance-script`, `dispatch-intent`, `docket-page` — pruned after merge), so its branch name could not be read from its entry; resolved from git instead, where branch `writer-drafts-intent` stands, matching the task-name = branch-name convention this TASK's own MANIFEST shows (`"branch":"acceptance-script"`).

`git diff --name-status writer-drafts-intent..acceptance-script`:
```
A  .pi/agents/acceptance-checker.md
M  .pi/agents/executor.md
M  .pi/agents/intent-writer.md
M  .pi/agents/investigator.md
M  docs/design.md
A  docs/intent/acceptance-script.md
```
Six files, all under `.pi/agents/` and `docs/`. **No file under `specs/`.**

## Step 7 — This run is the trial run — **PASS**

**Do:** confirm what I am.
**Evidence:** this session runs under the persona from step 1 — the charter in my own instructions matches `.pi/agents/acceptance-checker.md` word for word — holding this script's path (`/Users/yang/Projects/proofspec/.proofspec/dispatch/acceptance-script/acceptance.md`) and this worktree root (`/Users/yang/Projects/proofspec/.proofspec/worktrees/acceptance-script`), having executed every step for real with bash in this worktree. Every step above passed; this report is itself the step's evidence. No code, script, or merge was touched.

---

**Verdict: 7/7 PASS.** The one recorded observation (step 4's path shorthand in the script's own text) is a wording note for the executor, not a defect in the work.
