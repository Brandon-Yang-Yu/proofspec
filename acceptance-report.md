All five steps pass. Report:

---

## Acceptance — `prose-sweep` — PASS (5/5)

### Step 1 — Run the suite: `pnpm test` — **PASS**

> Standard: the whole suite green, exactly as on main — nothing functional moved, so no test may differ in outcome from main's run.

Command: `pnpm test`

```
 Test Files  88 passed (88)
      Tests  574 passed (574)
```

88 files, 574 tests, zero failures. ("judge: could not run pi: pi did not answer within 300ms" is a warning from the judge helper, not a test outcome.) Step 3 shows the branch touches only three prose `.md` files, so no functional code differs from main and outcomes cannot diverge from main's run.

### Step 2 — Run `pnpm spec:check` — **PASS**

> Standard: exit 0, no drift — the scenario blocks in the three files still mirror the tests exactly.

Command: `pnpm spec:check`

```
$ pnpm proofspec check
Term MANIFEST: its definition spells TASK in its everyday form 'task', and the edge of the vocabulary lives only in the exact form
spec:check exit: 0
```

Exit 0, no drift reported. (The `Term MANIFEST:` line is a terminology advisory the checker prints, not drift; drift would exit nonzero.) Step 5 independently confirms the blocks match main byte-for-byte, and Step 1 confirms the tests they mirror are green.

### Step 3 — Confirm the branch touches nothing outside the three spec files — **PASS**

> Standard: the diff names exactly `specs/cli.md`, `specs/schedule.md`, and `specs/guard.md`, and nothing else.

Command: `git diff main --stat`

```
 specs/cli.md      | 111 ++++++++---------------
 specs/guard.md    |   7 +-
 specs/schedule.md | 267 ++++++++++++++++++------------------------------------
 3 files changed, 125 insertions(+), 260 deletions(-)
```

Exactly the three named files, nothing else.

### Step 4 — Grep the three files for the defect phrases — **PASS**

> Standard: every grep prints nothing — zero hits for every phrase in all three files.

Command: the script's five-phrase fixed-string grep loop over `specs/cli.md specs/schedule.md specs/guard.md`.

Observed: no output from any of the five greps; the loop's exit status was 1 (no match on the final grep). Zero hits for all five phrases in all three files. Scope note honored — only the three files were grepped.

### Step 5 — Verify the scenario blocks are byte-identical to main's — **PASS**

> Standard: every file prints "scenario blocks identical" and no diff output — no scenario line moved, was added, or left.

Command: the script's loop extracting each file's `<!-- scenarios: generated -->`…`<!-- /scenarios -->` blocks from `git show main:` and the worktree copy, diffed.

```
specs/cli.md: scenario blocks identical
specs/schedule.md: scenario blocks identical
specs/guard.md: scenario blocks identical
```

All three identical to main, no diff output.

---

**Verdict: PASS.** The prose sweep removed the defect phrases from the three spec files, scenario blocks are untouched, the suite and spec check are green, and nothing outside the three files moved.
