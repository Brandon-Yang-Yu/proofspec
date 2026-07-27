---
name: ship
description: Run the ProofSpec build pipeline for one capability or one requirement — plan in Claude Code plan mode, tests-red, build-to-green, a fresh-subagent guideline review, a fresh-subagent completion check, archive the plan, then stop and wait for the human to say commit. Use when the user says "/ship <capability>" or asks to take work through the standard ProofSpec flow.
metadata:
  author: proofspec
  version: "1.0"
---

# /ship — the ProofSpec build pipeline

Take one capability, or one requirement inside it, from plan to a change that is ready to
commit — test-first, building ProofSpec on itself. Run the steps in order. Each step gates
the next; do not skip ahead.

There is no UI step: ProofSpec is a CLI library. There is no OpenSpec step: OpenSpec is
retired for our own build (`docs/design.md` §8), so the plan is made in Claude Code's plan
mode instead.

**Two hats, kept apart.** Through the build you are the *builder*. A builder is a poor
judge of their own fresh work — the context that just wrote the code is already convinced
it is right, so it skims past what a cold reader would catch. That is why the two review
gates (steps 4 and 5) hand off to a fresh subagent that never watched the code get
written. Reviewing and fixing stay separate hats too: the subagent only reports; you act
on what it finds.

Announce a short plan first, then work the steps. Keep the human posted at each hand-off.

## 1. Plan (Claude Code plan mode)

Enter plan mode. Produce the capability's spec: each `### Requirement:` with its one SHALL
sentence, and the Gherkin scenarios each requirement will carry. Written to
`specs/<capability>.md`, one file per capability.

This is the behavior gate — the one place the human confirms *intent*. State the scenarios
as `GIVEN/WHEN/THEN` in plain English, and get explicit confirmation that they are the
behavior the human wants before writing any test or code. Leave plan mode only when the
human approves the plan.

## 2. Tests, red

Write one test per scenario. Tag each with `// Capability:`, `// Requirement:`,
`// Scenario:` and its `// GIVEN/WHEN/THEN` steps, directly above the test that proves it.
Run them and confirm each fails for the right reason — the code is not built yet, not a
broken fixture.

Hand-fill the `<!-- scenarios: generated -->` blocks for the new capability. This is the
bootstrap: until `guard` runs, the tags are verified by hand.

## 3. Build to green

Implement until every test passes. Keep each capability's knowledge inside it — language
details stay in `test-scan`; everything downstream reads the contract only. Follow
`docs/typescript-style.md` as you write, so the guideline review has little to find.

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

## 6. Archive the plan

Record the plan approved in step 1 so the reasoning survives the build. The committed
`specs/<capability>.md` holds the requirements and scenarios; the plan's *why* — the
decisions and trade-offs behind them — belongs in `docs/design.md`, the way §12–§14 record
the earlier ones.

## 7. Wait for the human to say commit

Stop. Do not commit. Report what changed and that the gates are green, then wait.

When the human says commit, use conventional commits (`feat(scope): …`,
`docs(proofspec): …`). Unlike some repos, ProofSpec **requires** the trailer — end the message
with the `Co-Authored-By:` and `Claude-Session:` lines the repo convention specifies. Never
push to a remote unless the human asks.

## Finish

Report: the capability, the scenarios shipped, the gates green, and that the change waits
uncommitted for the human's go-ahead.
