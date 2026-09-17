# Acceptance check — TASK `dispatch-intent`

Checker: the acceptance-checker persona, run in-session by the executor (no subagent tool
available in this session). Script: `.proofspec/dispatch/dispatch-intent/acceptance.md`
in the main checkout. Worktree root: this branch's checkout. Every step run for real,
with bash, in that worktree. Verdict: **11/11 pass**.

## 1. The glossary TERM carries the two shapes and the one rule — PASS

Command: `sed -n '/^### Term: MANIFEST/,/^### Term: PROMISE/p' specs/glossary.md`.
Observed: the definition's second paragraph states the one rule with two shapes — the
reserved name `INTENT` naming `.proofspec/dispatch/<task>/INTENT`, "a conventional file
name in the family of `MANIFEST`, `state`, `LEASE`, and `heartbeat`", and any other value
naming a file on the TASK's `branch`; names the spec class writing no extra document and
the dedicated-doc class keeping its intent document as the queue entry's `INTENT` file
"committed nowhere, so its branch may reach `enqueue_task` carrying zero commits"; keeps
the reasoning that "the branch is the record for a file named on it, and the queue
entry's `INTENT` file is the record for the reserved name"; and carries both accepted
trade-offs ("an executor reads what the file says now" and the per-TASK record going
with the pruned entry while `docs/design.md` keeps the mechanism's principles).

## 2. The schedule requirement carries the resolution rule and its why — PASS

Command: `awk '/^### Requirement: A relationship is judged by a fresh agent/,/^<!--
scenarios/' specs/schedule.md`. Observed: the SHALL sentence reads each intent "by the
one rule its own MANIFEST's `intentRef` sets: the reserved name `INTENT` from the TASK's
own queue entry, and any other value from the TASK's `branch`"; the rationale states why
the reserved name exists (a dedicated-doc TASK "may carry zero commits on its branch, so
no file on that branch can hold its intent") and why the rule is one ("every reader —
the judge here, an executor cold-reading its own TASK — resolves the same `intentRef`
the same way"). The scenario block still carries its existing scenarios (12 entries,
the pre-existing eleven plus the new resolution-path scenario).

## 3. The ripple moved nothing — PASS

Commands: `git diff $(git merge-base main HEAD)..HEAD -- <file>` per file. Observed:
empty diffs for `specs/handoff.md`, `specs/inflight.md`, `specs/cli.md`,
`specs/docket.md`, `specs/progress.md`. In `specs/glossary.md` the only hunk is
`@@ -60,15 +60,32 @@`, entirely inside `### Term: MANIFEST`. In `specs/schedule.md` the
only hunks are `@@ -362,22 +362,31 @@` and `@@ -389,6 +398,7 @@`, entirely inside the
judge requirement's prose and its own generated scenario block.

## 4. The suite is green and the spec agrees — PASS

Commands: `pnpm test`; `pnpm spec:check`. Observed: "Test Files 83 passed (83), Tests
488 passed (488)"; `pnpm spec:check` exits 0 (the near-form note on Term MANIFEST
pre-exists at the base, verified against `fb10dcd` in a detached worktree). The tests
cover both shapes: `tests/schedule/end-to-end.test.ts:393` writes a MANIFEST with
`intentRef: 'INTENT'` read from the queue entry (scenario "The reserved INTENT name
reads the TASK's intent from its own queue entry, a path value from the branch"), and
the same file's `withIntent` fixtures cover the path-valued `intentRef` read from the
branch.

## 5. The resolution works end-to-end, through the real CLI — PASS

Built a throwaway git repo under `/tmp/acc-step5-XXXX` (identity set on the repo
itself): `main` holding `specs/cli.md` with `# cli`; TASK `spec-task` on branch
`work/spec-task`, one commit beyond main editing `specs/cli.md` and adding
`docs/intent-spec-task.md` holding `SPEC-CLASS INTENT MARKER`, queue entry MANIFEST
`{"intentRef":"docs/intent-spec-task.md","branch":"work/spec-task","base":{"kind":"main"}}`
and state `building`; TASK `doc-task` on branch `work/doc-task`, one commit beyond main
editing `specs/cli.md`, queue entry MANIFEST
`{"intentRef":"INTENT","branch":"work/doc-task","base":{"kind":"main"}}`, state
`building`, and an `INTENT` file holding `DEDICATED-DOC INTENT MARKER`. Stand-in judge:
an executable shell script appending every argument to a capture file and printing
`RESOLVED`.

Command: `PROOFSPEC_JUDGE_BIN=<fixture>/judge-stand-in PROOFSPEC_TMUX_SOCKET=<throwaway>
node --experimental-transform-types <worktree>/src/cli/main.ts schedule` from the
fixture root. Observed: exit 0 ("nothing to do" — both TASKs building, relationship
judged RESOLVED); the capture file holds both markers — `DEDICATED-DOC INTENT MARKER`
(line 12) and `SPEC-CLASS INTENT MARKER` (line 16) — and no "could not be read" for
either TASK.

## 6. The kickoff message names both shapes — PASS

Command: `grep -n -A3 "function kickoffFor" src/cli/session.ts`. Observed: the message
reads "read the MANIFEST's intentRef (the reserved name INTENT names the TASK's own
queue entry file .proofspec/dispatch/<task>/INTENT; any other value names a file on
this branch), then run the full pipeline through to merge." Both shapes named; the
message never directs every executor to the branch alone.

## 7. The investigator persona carries the rule — PASS

Commands: `grep -n "reserved name\|INTENT" .pi/agents/investigator.md` plus reading the
sections. Observed: the `intentRef` field description states both shapes and the one
rule ("read by one rule with two shapes — the reserved name `INTENT` names the TASK's
own queue entry file `.proofspec/dispatch/<task>/INTENT`, read from there ...; any
other value is a file path on the branch you just drafted, read as `git show
<branch>:<intentRef>`"). The "Draft the intent doc" section says the doc's destination
is the queue entry's `INTENT` file — "never a committed `docs/intent/<task>.md` — so it
is committed nowhere and the TASK's branch may reach `enqueue_task` carrying zero
commits" — that it is read back from that file and presented to the human in the
disposition review.

## 8. The executor persona carries the rule — PASS

Command: `grep -n -B1 -A4 "intentRef" .pi/agents/executor.md`. Observed: the Do item
naming `intentRef` reads "the `intentRef` resolves one way: the reserved name `INTENT`
names the TASK's own queue entry file `.proofspec/dispatch/<task>/INTENT` in the main
checkout, and any other value names a file on this branch."

## 9. The intent writer persona carries the rule — PASS

Command: `grep -n "INTENT\|docs/intent" .pi/agents/intent-writer.md`. Observed: the
frontmatter description and the "What you draft" bullet name the destination as "the
TASK's own queue entry file `.proofspec/dispatch/<task>/INTENT` in the main checkout —
never a committed `docs/intent/<task>.md`". "How you work" and "Do not" carry the same
boundary.

## 10. The design record carries the mechanism and both trade-offs — PASS

Command: `sed -n '/^## 59\./,$p' docs/design.md`. Observed: §59 names the reserved
`INTENT` name and the one rule with two shapes; the two classes (the spec class writing
no extra document; the dedicated-doc class writing the queue entry's `INTENT` file,
untracked, "a dedicated-doc TASK's branch may therefore reach `enqueue_task` carrying
zero commits"); and both trade-offs as accepted design decisions (the untracked record
read as it stands now; the per-TASK record going with the pruned entry, §39, while the
design record keeps the mechanism's principles).

## 11. The past intent docs stay untouched — PASS

Command: `git diff $(git merge-base main HEAD)..HEAD -- docs/intent/`. Observed: the
only change under `docs/intent/` is the new file `dispatch-intent.md`, this TASK's own
transitional document; no existing doc is modified or removed.
