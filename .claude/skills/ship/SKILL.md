---
name: ship
description: Run the ProofSpec build pipeline for one capability or one requirement — plan in Claude Code plan mode, tests-red, build-to-green, a fresh-subagent guideline review, a fresh-subagent completion check, close the review gate (touched + review, a fresh subagent per promise), a fresh-subagent acceptance check that runs the human-approved acceptance script for real against the CLI, archive the plan, then stop and wait for the human to say commit. Use when the user says "/ship <capability>" or asks to take work through the standard ProofSpec flow.
metadata:
  author: proofspec
  version: "1.0"
---

# /ship — the ProofSpec build pipeline

Take one capability, or one requirement inside it, from plan to a change that is ready to
commit — test-first, building ProofSpec on itself. Run the steps in order. Each step gates
the next; do not skip ahead.

**Tests before implementation, always.** No implementation code is written until the
scenario's test exists and has been run red. This holds in every mode and at every scale —
there is no change small enough, obvious enough, or urgent enough to skip the red test.
If you notice implementation happening without a red test behind it, stop and go back to
step 2.

The pipeline ships three kinds of change, and knowing which one you are in matters most
at the red gate (step 2):

- **New** — a capability or requirement that does not exist yet.
- **Fix** — the spec is right and the code disagrees with it.
- **Amendment** — the behavior the human wants has changed, so the spec changes first.

There is no UI step: ProofSpec is a CLI library. There is no OpenSpec step: OpenSpec is
retired for our own build (`docs/design.md` §8), so the plan is made in Claude Code's plan
mode instead.

**Two hats, kept apart.** Through the build you are the *builder*. A builder is a poor
judge of their own fresh work — the context that just wrote the code is already convinced
it is right, so it skims past what a cold reader would catch. That is why every judgement
hands off to a fresh subagent that never watched the work get written: the spec draft
(step 1), the guideline review (step 4), the completion check (step 5), the promise
reviews that close the review gate (step 6), and the acceptance check (step 7). Reviewing
and fixing stay separate hats too: the subagent only reports; you act on what it finds.

Announce a short plan first, then work the steps. Keep the human posted at each hand-off.

## 1. Plan (Claude Code plan mode)

Enter plan mode. Work out the shape of the change with the human — which capability, which
requirements, what a "new" one needs from scratch or what a "fix"/"amendment" changes — but
the requirement's SHALL sentence and its rationale, and any TERM's definition, are not yours
to write. Spawn a fresh subagent, the **spec steward**, to draft them.

**The spec steward drafts prose, you never do.** You are the builder, and a builder is a
poor judge of their own fresh wording the same way step 4-6's reviewers exist because you
are a poor judge of your own fresh code. Hand it the change intent in the human's own words
and the worktree root. It runs the real census — `rg -n '^### Requirement:' specs/*.md` and
`rg -n '^### Term:' specs/*.md` — classifies every row **gone / reworded / kept / new**
against the intent (the same `gone`/`reworded`/`new` vocabulary `inflight`'s own queue-facing
census uses, per docs/design.md §42/§50), and drafts real prose for every non-`kept` row, in
the register the surrounding spec already uses.

**A requirement's rationale states the current, correct design and why it is correct — never
the history of how the draft got there.** Comparing against an alternative is only worth the
words when that alternative is a standing design principle this capability (or the wider
tool) keeps re-asserting elsewhere — "never probe whether a process is still alive" is that
kind of contrast, worth repeating wherever it applies. A one-off drafting mistake an earlier
round happened to write down, later corrected, is not: mentioning it teaches a reader nothing
about why today's design is right, only that an earlier draft said something else. When a
round revises earlier prose, drop what the revision made untrue rather than layering the new
reasoning on top of the old.

It commits directly onto **this task branch**, never a branch of its own: the worktree was
already cut for this one change, so nothing a separate branch would protect is not already
protected by the task branch itself. The first round commits (`git add specs && git commit
-m "docs(specs): <capability>"`); every round after that **amends the same commit** (`git
commit --amend --no-edit`) rather than adding another one, so however many rounds the human
needs, the branch never carries more than this one spec commit.

When a row touches a TERM, the ripple is measured, not guessed: after committing, it runs
`pnpm proofspec touched --since "$(git merge-base HEAD main)" --format json` against its
own real commit and reports every requirement the changed TERM reopens, for the human to
rule on alongside the table. It returns the table, the ripple, and the drafted prose quoted
back from the file after committing — never retyped from memory, so the report the human
rules on and the commit that lands are never two different things.

This is the behavior gate — the one place the human confirms *intent*. State the scenarios
as `GIVEN/WHEN/THEN` in plain English, and get explicit confirmation — of the spec steward's
wording and of the scenarios — before writing any test or code. Leave plan mode only when
the human approves the plan.

Alongside the scenarios, draft the **acceptance script** — the outside view of the same
intent. A scenario is a promise inside the system; this is what a person would actually
run to see the promise land, since ProofSpec is a CLI library and "using the product"
means running the `proofspec` binary the way a consuming project would. Write an ordered
list of concrete steps — each one a literal invocation (`proofspec <verb> ...`, or
`pnpm test`) paired with the literal thing you'd see printed or written if it worked —
plain enough to run by hand with no more context than the list itself. Confirm it with
the human in the same round as the scenarios; it is part of the one intent, not a second
approval. Once confirmed, persist it — `git rev-parse --git-dir` names this worktree's
own private admin directory, never tracked and never part of the working tree, so write
it to `$(git rev-parse --git-dir)/ship-acceptance-<capability>.md` — so step 7 reads it
back verbatim rather than relying on a plan that may no longer be in context by then.

## 2. Tests, red

Write one test per scenario. Tag each with `// Capability:`, `// Requirement:`,
`// Scenario:` and its `// GIVEN/WHEN/THEN` steps, directly above the test that proves it.
Run them and confirm each fails for the right reason — which depends on the kind of
change:

- **New**: the test fails because the code is not built yet.
- **Fix**: the test is written against the scenario as the spec states it, and fails
  because today's code behaves wrongly. That failing run *is* the reproduction — if the
  new test passes on the unfixed code, it does not pin the defect.
- **Amendment**: the existing tests are changed to say the new behavior first, and fail
  because the code still implements the old behavior. A test that keeps passing across
  the amendment was not testing the part that changed.

In every mode the wrong reason is the same: a broken fixture, a typo, a test that would
fail against any implementation.

For a **new** capability the tests may not compile without a source file to import. The
only implementation allowed before red is minimal scaffolding — empty exports, type
stubs — just enough for the tests to run and fail for the right reason. Scaffolding that
makes any test pass is implementation, and it belongs in step 3.

This step ends with a test run whose failures you show. Do not proceed to step 3 without
that red run in hand.

Hand-fill the `<!-- scenarios: generated -->` blocks for the new capability. This is the
bootstrap: until `guard` runs, the tags are verified by hand.

## 3. Build to green

Implement until every test passes. Keep each capability's knowledge inside it — language
details stay in `test-scan`; everything downstream reads the contract only. Follow
`docs/typescript-style.md` as you write, so the guideline review has little to find.

If the build surfaces behavior no scenario covers — an edge case, a needed error path, a
requirement the plan missed — do not code it and backfill the test later. Stop, return to
step 1 to get the scenario confirmed (or step 2 if it clearly falls under an approved
requirement), write its test, run it red, then resume building.

## 4. Guideline review — fresh subagent

Spawn a fresh subagent that did not write the code. Hand it the diff and
`docs/typescript-style.md`. It reports every deviation with `file:line`, plus any
borderline judgment call, and fixes nothing. It checks at least: readability on first read,
discriminated unions over flag piles, guard clauses, ≤2–3 params and no boolean params,
expected errors as values not `throw`, immutable data, comments say WHY, YAGNI, plain
English, strict `===`, no `any`.

Then fix every clear deviation yourself, and pass the borderline calls to the human rather
than deciding them quietly.

## 5. Completion check — fresh subagent

Spawn a fresh subagent. Hand it the capability spec, the implementation, and the tests. It
confirms two directions: every requirement is genuinely satisfied by the code, not just
plausibly; and every scenario's test really pins the claim it makes, rather than asserting
something weaker. It reports gaps and fixes nothing.

Then close every gap, and run the gates green: `pnpm test` and `pnpm typecheck`.

## 6. Close the review gate — a fresh subagent per promise

The build is green and checked, but its promises are not yet judged. The repo's doors —
`.githooks/pre-merge-commit` and `.githooks/pre-push` — hold exactly that: `proofspec
touched` exits non-zero while any promise the change reached has no review standing against
it. Close the gate here, on the final shape of the branch's tests, so the doors never hold.

Run the work list:

```sh
pnpm proofspec touched --format text
```

Exit 0: every promise is judged — the gate is closed. Otherwise the list names one key per
requirement reached. For each key:

1. **Fetch** — `pnpm proofspec touched --requirement <key>`. The payload carries the
   requirement's claims, the proving lines as they stand, and the judging protocol: the
   question to judge by and the exact commands to record either verdict.
2. **Judge** — a fresh subagent per key, the same two-hats rule as steps 4 and 5: the
   context that wrote the promise is already convinced of it, and the ledger's first
   reader asks whether the reviewer was the author. One subagent per key keeps each
   context bounded to one requirement's claims. The reviewer records its own verdicts
   with the payload's protocol, under a reviewer name of its own (`--by`) — never the
   builder's.
3. **Settle findings** — a verdict settles its promise whatever it said; the gate asks
   whether every promise was looked at, not whether every judgement was favourable. A gap
   or drift is a finding to fix, and the fix is itself a change: keep `pnpm test` green,
   and a fix that touches a test re-keys the promises it proves, so re-run the work list.
   Exit 0 on the final shape of the branch's tests is the only shape that closes.

`.proofspec/reviews.jsonl` is committed, riding with the work it judges — this repo's
convention is its own `chore(review):` commit when the judgements read cleaner apart from
the change.

## 7. Acceptance check — fresh subagent

Spawn a fresh subagent that did not write the code or the plan. Hand it the acceptance
script from step 1 — read `$(git rev-parse --git-dir)/ship-acceptance-<capability>.md`
back rather than retyping it from memory — and the worktree root. It runs the script for
real, one step at a time, from bash: a read-only verb (`check`, `touched`, `render`) runs
directly against this repo, a verb that writes (`write`) runs against a disposable scratch
copy instead, so nothing the check does leaves a side effect in the working tree. Per
step it reports **pass** (saw the literal thing named), **fail** (what it actually saw
instead), or **can't-tell** (the step could not be run as written) — and fixes nothing.

A fail is a finding like any other: fix it, and because the fix touches code, steps 4–6
run again on the new shape before the acceptance check runs once more. It never edits the
script itself — a step that asks the wrong thing is a step-1 question, not one this gate
quietly corrects.

## 8. Archive the plan

Record the plan approved in step 1 so the reasoning survives the build. The committed
`specs/<capability>.md` holds the requirements and scenarios; the plan's *why* — the
decisions and trade-offs behind them — belongs in `docs/design.md`, the way §12–§14 record
the earlier ones.

## 9. Wait for the human to say commit

Stop. Do not commit. Report what changed and that the gates are green, then wait.

When the human says commit, use conventional commits (`feat(scope): …`,
`docs(proofspec): …`). Unlike some repos, ProofSpec **requires** the trailer — end the message
with the `Co-Authored-By:` and `Claude-Session:` lines the repo convention specifies. Never
push to a remote unless the human asks.

## Finish

Report: the capability, the scenarios shipped, the gates green, the review gate closed
(the work list exits 0), the acceptance check clean, and that the change waits uncommitted
for the human's go-ahead.
