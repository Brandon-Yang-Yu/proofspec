# OpenTDD — design record

A record of the design discussion. Captures the reasoning, not just the
conclusions, so a later reader (or AI) can see *why* each choice was made.

---

## 1. The problem

The same behavior is written twice — a **spec** (plain English, for the product
team) and a **test** (code, for engineers). They drift apart the moment nothing
ties them together.

The deeper goal, and the reason to care: **when the behavior claim sits next to the
test, a person or an AI can judge "does this test actually satisfy its expected
behavior?"** Co-location is what makes that judgement cheap.

## 2. The model

The project's spec is a tree, and the tree is expressed *by the tests*:

```
project spec (expressed by tests)
└── capability          e.g. agent-chat
    └── requirement      a high-level promise (one SHALL sentence)
        └── scenario     one detailed condition, written as Gherkin above its test
            └── test      exactly one test proves it
```

- **capability** — a feature area (matches how OpenSpec groups specs).
- **requirement** — the high-level promise. Few, coarse, product-reviewed. Split
  into scenarios.
- **scenario** — one detailed condition. Its behavior is written as Gherkin above
  the test.
- **test** — the leaf. Exactly one test per scenario.

## 3. Core principles

1. **Tests are the source of truth for behavior.** To change behavior you change
   the test. No separate canonical spec file holds a second copy.

2. **Behavior is written as Gherkin — plain English in WHEN/THEN steps — directly
   above the test.** Not free-form prose; the WHEN/THEN skeleton is the structure,
   the words are plain English.

3. **One scenario ↔ one test (a bijection).** A scenario is proven by exactly one
   test; a test proves exactly one scenario. This is not a limitation — at a
   different layer the observable behavior is *different*, so it is phrased
   differently and becomes a *different* scenario. "One scenario, many tests" is
   therefore a modelling error, and the tool flags it.
   - Example (from the reference repo): "concurrent turns run in order" listed two test
     files. Those are really two scenarios — an API one ("returns 422…") and a unit
     one ("runTurn returns agent_failed…") — lumped into one row.

4. **A requirement is a node with its own home — not pure text.** Every requirement
   splits into scenarios, so it must record *where its scenarios are*. Its storage
   is therefore its description plus a generated list of scenario locations.

5. **OpenTDD does not care which layer a test is (api / component / e2e / unit).**
   It only records "this scenario is proven by that test." The layer is the test
   author's concern, not the tree's.

## 4. Storage vs. delivery — the key architectural decision

The recording format is **Markdown** (git-friendly, human-readable). But a naive
`→ tests/x.test.ts:42` rots the instant someone inserts a line above the test.

So we split **what is stored** from **what is delivered**, the way the
codebase-memory index does (it stores a stable `qualified_name`; `get_code_snippet`
resolves the current line range fresh):

| | Holds | Changes when… |
|---|---|---|
| **Storage** (committed `.md`) | capability → requirement (SHALL, authored) → scenario title + **file** (generated) | a scenario is added / removed / renamed / moved file — all meaningful |
| **Delivery** (a tool) | the current `file:line`, jump-to-test, the rendered tree | every call, computed live — always correct |

**Line numbers are delivered, never stored.** The tool finds a scenario by grepping
`// Scenario: <title>` (titles are unique within a requirement, per the bijection)
and reports the current line. Because line numbers never enter the stored file,
editing a test never produces a false "spec drifted" diff.

## 5. Where each piece lives (zero duplication)

| Thing | Home | Written by |
|---|---|---|
| requirement description (SHALL) | the capability `.md`, above the generated marker | human |
| scenario behavior (Gherkin WHEN/THEN) | the test, above its `it` | human |
| scenario location (title → file) | the capability `.md`, inside the generated marker | tool |

Shape of a capability file:

```markdown
# opentdd

### Requirement: Tests are the source of truth for behavior
The tests SHALL be the one place that says how the product behaves. …   ← human

<!-- scenarios: generated -->
- "A scenario is written above the test that proves it"   → tests/opentdd/parse.test.ts
- "One scenario is proven by exactly one test"            → tests/opentdd/guard.test.ts
- "Behavior is not duplicated outside the test"           → tests/opentdd/guard.test.ts
<!-- /scenarios -->
```

Note the generated block stores **title + file only, no WHEN/THEN** — copying the
Gherkin in would violate principle 1 ("behavior lives only in the test"). The model
is self-consistent.

## 6. The tool's jobs

A single script (`opentdd`), in the spirit of an MCP resolver:

1. **Deliver** — resolve any scenario's current `file:line`, jump to its test,
   render the whole tree for a human to read.
2. **Guard (fail the build)** — scan the tests, rebuild the stable tree
   (titles + file), compare against the committed `.md`, fail on drift. Line numbers
   do **not** enter this comparison, so line shifts never false-alarm.
3. **Write back** — refresh the `<!-- scenarios -->` blocks from the latest scan.

## 7. Build-fail rules

`index`/capability `.md` is committed; the guard regenerates the stable tree and
compares. Rules:

| # | Rule | Catches | Level |
|---|---|---|---|
| 1 | Stale file — regenerated stable tree ≠ committed `.md` | forgot to write back | FAIL |
| 2 | Dangling requirement — `// Requirement: X` has no `### Requirement: X` in the capability file | requirement renamed/deleted, test not updated | FAIL |
| 3 | Uncovered requirement — a declared requirement has no scenario tagged in any test | a feature written but not tested | FAIL |
| 4 | Half tag — a `// Requirement:` without a `// Scenario:` (or vice-versa) | mis-tagged | FAIL |
| 5 | Missing capability — a file has Requirement/Scenario tags but no `// Capability:` | unlocatable | FAIL |
| 6 | Duplicate scenario — the same (capability, requirement, scenario) tagged by 2+ tests | bijection broken; layers not split | FAIL |
| 7 | Empty behavior — `// Scenario:` with no WHEN/THEN beneath before the `it(` | co-location in name only | WARN (may become FAIL) |

Opt-in: a capability is enforced (rules 2, 3) simply by having a capability `.md`.
Older suites are not forced to retag all at once.

## 8. Relationship to OpenSpec

**Decision: thin layer, not a fork.** Keep the published `openspec` CLI for the
plan-time `propose` / `change` flow (it is maintained, and we don't want to own it).
OpenTDD is a small tool around it.

Findings from reading the OpenSpec source (`@fission-ai/openspec` 1.6.0, MIT):

- **~34,500 LOC across ~175 files**, but the reusable kernel (parsers + validation +
  schemas) is only **~1,900 LOC**. The other ~32k is stores, shell completions, a
  templating engine, telemetry, legacy migration — none of it needed.
- The parser turns a `spec.md` into `{ requirements: [{ text, scenarios: [{ rawText }] }] }`.
  It **discards scenario titles and line numbers** — it is built for validation, not
  for the title+location indexing OpenTDD needs. So we don't lift the file; we borrow
  two ideas: the nested-header "section tree" walk, and the code-fence mask (so a
  `####` inside a ``` block is not mistaken for a header).
- **`openspec validate` requires every requirement to have ≥1 scenario** (a hard
  ERROR). So a requirements-only `spec.md` is impossible under the tool. Therefore
  OpenTDD **retires `openspec/specs/` as the durable store** — OpenSpec is used only
  to author change proposals (which do carry scenarios and validate fine); OpenTDD
  owns the archive→tree step instead.

So the "base" we build on is the *format* (Requirement + Scenario/WHEN/THEN) and two
parsing tricks — not the 34k-line binary.

## 9. Workflow

OpenTDD's lifecycle, mapped onto the OpenSpec verbs:

1. **Confirm the requirement** — establish the high-level promise (product-reviewed,
   pre-code). `openspec propose` fits here.
2. **Refine into scenarios** — break the requirement into detailed conditions.
3. **Apply** — create the test for each scenario; the scenario's Gherkin is written
   above its `it`. The requirement's `.md` gets its scenario locations written back.

## 10. Draft — OpenTDD's own top-level requirement

Written in OpenTDD's own format (mirroring OpenSpec). **Draft, not finalized.**

```markdown
## opentdd

### Requirement: Tests are the source of truth for behavior

The tests SHALL be the one place that says how the product behaves. Each scenario
SHALL be written as Gherkin — plain English in WHEN/THEN steps — on the lines
directly above the single test that proves it, so anyone (a person or an AI) can read
the claim and the code together and judge whether the test really does what the claim
says. A scenario SHALL be proven by exactly one test, and a test SHALL prove exactly
one scenario. The behavior text SHALL NOT be copied into a second file: a high-level
requirement MAY be written on its own, but every scenario SHALL live with its test.

#### Scenario: A scenario is written above the test that proves it
- **WHEN** someone opens a test file
- **THEN** each test has its expected behavior written directly above it as Gherkin —
  plain English in WHEN/THEN steps

#### Scenario: One scenario is proven by exactly one test
- **WHEN** a scenario is added
- **THEN** exactly one test proves it, and no other test claims the same scenario

#### Scenario: Behavior is not duplicated outside the test
- **WHEN** a scenario's behavior is recorded
- **THEN** it appears only above its test, and no separate spec file keeps a second copy
```

## 11. Open questions / next steps

- **A tool requirement is still missing** — a requirement that says "the tool
  delivers current locations and fails the build on drift; line numbers are computed,
  not stored." Add it below the top-level one.
- **The tree file(s)** — one file per capability, plus a top-level index of
  capabilities? Or a single file? (Leaning per-capability.)
- **Real starting point** — decide where OpenTDD lands relative to the reference repo
  (the earlier `worktree-turn-route` spec-binding work is a stale snapshot; main has
  moved on). Verify before building.
- **Then**: build the parser + the capability-file writer + the guard, TDD, using
  OpenTDD on itself.
