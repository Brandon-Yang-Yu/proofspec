---
name: audit
description: Audit spec↔test↔code coherence across the whole repo — run ProofSpec's own check for mechanical drift, then fresh review subagents judge whether every test still pins what its scenario claims. Reports only; fixes nothing. Use when the user says "/audit" or asks whether the specs, tests, and code still agree.
metadata:
  author: proofspec
  version: "1.0"
---

# /audit — does the repo still agree with itself?

`/ship` guards one capability while it is being built. Entropy accumulates *between*
ships: a scenario moves, a test weakens, a committed file goes on claiming what nothing
proves anymore. This skill runs ProofSpec on its own repo and reports the drift.

It changes nothing. The check never writes (`specs/cli.md` requirement 1), and neither
does the auditor: findings go to the human, and fixes travel through `/ship` or by hand,
as a separate decision.

**Separate hats, enforced.** Every judgment pass is done by a fresh subagent that did
not write the code it is auditing — the same reasoning as ship's review gates: a context
that built the thing skims past what a cold reader would catch. The main context only
orchestrates, runs the mechanical check, and aggregates. It judges nothing itself and
fixes nothing.

## 1. Mechanical drift — the tool's own check

From the repo root run:

```
pnpm proofspec check --json
```

Never run `write` from this skill — audit reads.

- Exit 0 with `"status":"pass"` — the tests and the committed capability files agree.
- The drift exit code — the findings name each disagreement: a scenario the tests prove
  but no file records, a recorded scenario no test proves, a scenario that moved.
- The cannot-run exit code — an input could not be read. Report that as a finding in its
  own right and say which capabilities it shadows: the audit cannot vouch for what the
  tool could not read.

## 2. Judgment audit — fresh subagents, one per capability

Mechanical agreement is necessary, not sufficient: a recorded scenario can match its
test while the test asserts something weaker than the scenario's claim. This lane is
ship's completion check (step 5), aged — asked of code that has kept changing since the
capability shipped.

For each capability file in `specs/`, spawn a fresh subagent. Hand it the capability
file and the test files its scenarios name. It confirms both directions:

- every requirement is still genuinely satisfied by the code as it stands today, not
  just plausibly; and
- every scenario's test still pins the exact claim the scenario makes, rather than
  asserting something weaker or something adjacent.

It reports each gap with `file:line` and a sentence on what the scenario claims versus
what the test proves. It fixes nothing. Run the capabilities' subagents in parallel —
they are independent by construction, because each capability keeps its knowledge
inside itself.

## 3. Report and stop

Aggregate one report: the mechanical findings first, then the judgment findings grouped
by capability, each with `file:line`. Say plainly when a lane is clean — "no drift" is a
result, not an absence of one.

Do not fix anything. End by asking the human which findings, if any, to take through
`/ship` — a weakened test is a **fix**, a scenario that no longer describes wanted
behavior is an **amendment**.
