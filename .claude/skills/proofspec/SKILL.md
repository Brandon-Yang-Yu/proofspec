---
name: proofspec
description: Use ProofSpec in a repo — write capability specs and tagged tests, run check/write/render, and keep the tests and the committed spec files in agreement. Use when the user says "/proofspec", mentions spec drift, asks to record scenarios or update the spec from the tests, or when editing files under specs/ or tests carrying // Capability tags.
metadata:
  author: proofspec
  version: "1.0"
---

# /proofspec — the test suite is the living spec

ProofSpec keeps three things in agreement: the capability files in `specs/`, the tagged
tests that prove them, and the code. The tests are the source of truth for *what is
proven*; the committed files record it; `check` fails the build when they disagree.

This skill is the operating manual: the two file formats, the three commands, and the
rules that keep an agent from corrupting either half. In this repo the CLI runs as
`pnpm proofspec <command>`; in a consumer repo, run it however the tool is installed.

## The capability file — `specs/<capability>.md`

One file per capability. Each requirement is a `### Requirement:` heading, one SHALL
sentence, and prose saying why. Under it sits a generated block recording which tests
prove it:

```markdown
### Requirement: The exit code says what happened

The check SHALL exit zero when the tests and the committed files agree.

<!-- scenarios: generated -->
- "Agreement between the tests and the committed files exits zero" → tests/cli/exit-code.test.ts
<!-- /scenarios -->
```

The file has two owners, and the boundary is the block markers:

- **Everything outside the generated blocks is the human's.** Headings, SHALL
  sentences, rationale — edit these like any prose, with the human's confirmation.
- **Everything inside is the tool's.** Never hand-edit between
  `<!-- scenarios: generated -->` and `<!-- /scenarios -->`; only the `write` command
  touches it. Each entry is a scenario title and the file that proves it — no Gherkin,
  no line numbers, ever.
- An empty block is an ordinary state (a requirement nothing proves yet), not an error.
- `write` will not invent a requirement heading: entries for a requirement the file
  does not declare are left out and reported. Declaring requirements is authoring, and
  authoring is the human's half.

## The tagged test

A test file names its capability once at the top; each test carries its requirement,
scenario, and Gherkin directly above it:

```ts
// Capability: cli

// Requirement: The exit code says what happened
// Scenario: Agreement between the tests and the committed files exits zero
// GIVEN a repo whose committed file records exactly the scenarios the tests prove
// WHEN the check runs
// THEN its exit code is zero
it('exits zero when the tests and the committed files agree', async () => { … })
```

The scan's contract, so tags parse the way you meant them:

- One `// Capability:` per file at most; two is an error, none makes every proof site
  unresolved.
- Step keywords are GIVEN, WHEN, THEN — **AND is an error**. A comment line with no
  keyword continues the step above it; that is how a step runs to a second sentence.
- Only `//` comments count, and only with **no blank line** between the tags and the
  test. A `/* */` block is never a step.
- Tags sit either above a test (the whole test is one proof site) or above statements
  inside it (each opens a block) — one test may not mix both placements.
- `it`/`test` with `.each`/`.skip`/`.only`/`.concurrent`, at any `describe` depth, all
  count; a parameterised test is one proof site however many rows it has.
- Scanning reads one file at a time and never compiles: broken types or missing
  imports do not change the answer, so the spec stays readable mid-refactor.

## The three commands

All accept `--specs <dir>` and `--tests <dir>` (defaults: `specs`, `tests`) and
`--json`. A conventional layout needs no configuration. When acting on the output,
prefer `--json` over parsing the text form.

| Command | Does | Exit | `--json` shape |
|---|---|---|---|
| `check` | Rebuilds the tree from the tests and reports drift. **Never writes.** | 0 agree · 1 drift · 2 cannot-run | `{"status":"pass"\|"fail","findings":[…]}` |
| `write` | Records what the tests prove into the generated blocks; touches nothing else; idempotent. Refuses and changes nothing if any test cannot be read. | 0 · 2 cannot-run | `{"changed":[files]}` |
| `render` | Writes the readable site (an index, one page per capability, one per test file) into `build/` or `--out`. Output is generated — gitignore it. | 0 · 2 cannot-run | `{"changed":[files]}` |

Exit 1 and exit 2 are deliberately different so CI can tell "your spec is wrong" from
"I could not run". A cannot-run answer is `{"error": reason}` — treat it as its own
failure, never as a pass.

## Working rules

- **Check often, write on purpose.** `check` belongs in CI and before commits. `write`
  is run deliberately after tests changed, and its diff is reviewed like any other
  change — a check that quietly fixed files would report success on a repo that was
  wrong until it ran.
- **Fix drift at its cause.** Drift means the tests and the committed files disagree.
  Decide which is right: fix the test or its tags, or run `write` to record what the
  tests now prove. Never "fix" drift by hand-editing a generated block.
- **Behavior changes start in the spec.** A new or changed scenario is agreed in the
  capability file's terms (SHALL sentence, GIVEN/WHEN/THEN) with the human before the
  test that proves it is written.

## Adopting ProofSpec in a repo

Put capability files in `specs/`, tag the tests, add `check` to CI — no configuration
file exists to create. Then offer to add this to the repo's `CLAUDE.md`/`AGENTS.md`, so
the rules are in context even when this skill is not loaded:

```markdown
## ProofSpec
- `specs/*.md` are capability specs; tests carry `// Capability:` / `// Requirement:` /
  `// Scenario:` tags with GIVEN/WHEN/THEN directly above each test.
- Run `proofspec check` before committing. Fix drift by fixing tests or running
  `proofspec write` — never by editing a `<!-- scenarios: generated -->` block by hand.
```
