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
        └── scenario     one detailed condition, written as Gherkin by its proof
            └── proof     exactly one place proves it
```

- **capability** — a feature area (matches how OpenSpec groups specs).
- **requirement** — the high-level promise. Few, coarse, product-reviewed. Split
  into scenarios.
- **scenario** — one action and one outcome: `(GIVEN, WHEN) + one THEN`. Its behavior
  is written as Gherkin at the place that proves it.
- **proof site** — the leaf. A whole test, or a block of assertions inside one when
  several scenarios share that test's action. Exactly one per scenario.

## 3. Core principles

1. **Tests are the source of truth for behavior.** To change behavior you change
   the test. No separate canonical spec file holds a second copy.

2. **A scenario's identity is `(GIVEN, WHEN) + one THEN`.** Same action, same
   outcome → same scenario. Change either and it is a different one. This is the
   load-bearing rule: it is the only one that says what *one behavior* is, so
   everything below rests on it — without it "one scenario ↔ one proof site" has
   nothing to count.
   - It replaces the earlier rule "a different layer is a different scenario", which
     turns out to be a special case: api / component / e2e differ because the
     *action* differs (calling a function is not sending a request), not because a
     layer label differs.
   - It is why AND is banned. An AND under a THEN admits a second outcome — which by
     this rule is a second scenario. AND is the one keyword that can smuggle one in
     without anyone noticing, so removing it turns every "and…" into a question:
     *can one block of assertions prove this?* Yes → another sentence in the same
     THEN. No → it was a second scenario all along.
   - It settles all four of the cases the layer rule could not — see §11.
   - **The tree partitions outcomes, not actions.** A requirement groups by promise;
     a scenario is identified by observation. The two are different dimensions, which
     is why one action can legitimately appear under several requirements (see the
     second bullet of principle 4) instead of that being a violation.

3. **Behavior is written as Gherkin — plain English in GIVEN/WHEN/THEN steps — at
   the place that proves it.** Not free-form prose; the GIVEN/WHEN/THEN skeleton is
   the structure, the words are plain English.

4. **One scenario ↔ one proof site (a bijection).** A proof site is a whole test
   when that test proves one scenario, or a block of assertions inside a test when
   several scenarios share its GIVEN/WHEN. Two proof sites claiming the same
   scenario is a modelling error and the tool flags it.
   - Rows of input that differ only in data ride one parameterised test; that test
     counts as one proof site. Every row must reach the same THEN — a row that
     reaches a different outcome is a second scenario in disguise.
   - One action with several outcomes (a slow e2e that proves three promises at
     once) stays one test: the shared GIVEN/WHEN sits above it, each THEN sits on
     its own assertion. The bijection holds because each scenario still has exactly
     one place that proves it.

5. **A requirement is a node with its own home — not pure text.** Every requirement
   splits into scenarios, so it must record *where its scenarios are*. Its storage
   is therefore its description plus a generated list of scenario locations.

6. **OpenTDD does not care which layer a test is (api / component / e2e / unit).**
   It only records "this scenario is proven there." The layer is the test author's
   concern, not the tree's.

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
| 6 | Duplicate scenario — the same (capability, requirement, scenario) tagged at 2+ proof sites | bijection broken; the action was not the same after all | FAIL |
| 7 | Empty behavior — `// Scenario:` with no GIVEN/WHEN/THEN beneath before the assertion | co-location in name only | WARN (may become FAIL) |

A proof site is a whole test, or a tagged block of assertions inside one — rules 4-7
apply to each site, not to each `it(`. A parameterised test (`it.each`) is one site
however many rows its table has.

Two things the guard deliberately does **not** check, because they need judgement and a
person or an AI reading the co-located claim can supply it:

- that every row of a table reaches the same THEN (a row with its own outcome is a
  second scenario in disguise);
- that scenarios sharing a test really share its GIVEN/WHEN, rather than having been
  folded together to save an expensive setup.

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

**Superseded by [`docs/spec.md`](spec.md)**, which carries the finalized requirements.
Kept here as the record of the first draft; where the two disagree, `spec.md` wins.

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

## 11. The bijection, checked against a real suite

The one-scenario-one-test rule was a bet. The reference repo settles it, because that repo already
runs a cruder version of this idea: every `it` carries a `// Spec: <capability> › "<title>"`
tag, and `tests/spec-coverage.test.ts` (103 lines) checks both directions — every tag
names a real scenario, and every scenario of an *enforced* capability has at least one
tag. It is OpenTDD's guard minus rule 6.

That "minus rule 6" is what makes it a clean experiment: **nothing there was enforcing
the bijection, so whatever shape the suite grew into is the honest one.** Counted over
11 capabilities / 57 requirements / 137 scenarios, of which 2 capabilities are enforced
and 46 scenarios are tagged by 56 tests:

- **13 of 46 scenarios (28%) are proven by more than one test.**
- **4 tests each claim two scenarios.**

Both directions break. Reading all 13:

| Kind | Example | Verdict |
|---|---|---|
| **Cross-layer** | `"Reject an unknown template"` — a unit test asserts `unknown_template`, an e2e asserts `422 and creates no document` | Two scenarios. The old layer rule got this right, but for the wrong reason: the *actions* differ. |
| **Same file, same layer** | `"The turn failed"` — one test for the stream erroring, one for the request failing. And `"The guardrails scope writes **and** block shell and network"` — the title says "and" out loud | Two scenarios; the scenario was written too coarsely. The layer rule could not reach these, the identity rule can. **This is the bijection earning its keep** — it caught a title with two claims stapled together. |
| **Parameterised** | `"A malformed body is rejected before the stream opens"` — one test for a missing instruction, one for a blank one | *Not* two scenarios: one rule, two inputs. Splitting yields two descriptions differing by one word. → decision A below. |
| **One action, many outcomes** | `turn.e2e.test.ts:150` proves both `"A turn streams the reply and appends one version"` and `"A successful turn appends the new document"` — one POST, two things observed | Not a modelling error at all. → decision B below. |

The last two are the ones §3's original rule could not settle, and they pull in opposite
directions: the coarse-title case says *split scenarios finer*, the shared-action case
says *merge them coarser*. A rule that only knew about layers had nothing to say to
either.

**Decision A — a table, not a split.** Inputs that differ only in data are one scenario
on one parameterised test; the table lives where it already lives, in the `it.each`
array. The distinction between a missing field and a blank string is real, but it is
real *in the test* (different code paths, different bugs) and not *in the spec* (a reader
needs one sentence). The table is the seam between those two layers. Constraint: every
row reaches the same THEN — checked by judgement, not by the guard.

**Decision B — the THEN moves to its assertion.** When one action proves several
scenarios, the shared GIVEN/WHEN stays above the test and each scenario's THEN sits on
the assertion that checks it. The bijection survives because the unit was never really
"a test" — it is *a place that proves one scenario*, and a place can be a block of
assertions. Forcing a split here would mean re-running an expensive setup to assert half
of what it already demonstrated. This also tightens co-location rather than loosening it:
the claim now sits on the very line that proves it.

Known cost of B: assertions in one `it` share a fate — the first failure hides the rest,
so a broken scenario A masks scenario B's status. Mitigate by keeping the blocks
independent of one another and preferring soft assertions (`expect.soft`) where the
runner offers them.

What the check also confirmed: the guard is closer than §11 used to assume. The reference repo's 103
lines already do rules 2, 3 and half of 1; the genuinely new work is rule 6, dropping
line numbers out of the comparison, and parsing proof sites inside a test.

And a live example of the problem OpenTDD exists to solve: in the reference repo the same behavior is
currently written in **three** places — `openspec/specs/agent-chat/spec.md`, a full
Gherkin `Feature` block in `docs/behaviors/agent-chat.md`, and a prose summary at the top
of the test file. That is the first thing worth migrating.

## 12. Open questions / next steps

- **A tool requirement is still missing** — a requirement that says "the tool
  delivers current locations and fails the build on drift; line numbers are computed,
  not stored." Add it below the top-level one.
- **Proof-site syntax** — a scenario tagged above an `it` is settled; a scenario tagged
  on a block of assertions inside one needs its comment shape pinned down (and the
  parser needs to know where a block ends — the next tag, or the end of the `it`).
- **Do requirement descriptions need a revision?** The guard compares titles and files,
  so editing a requirement's SHALL text while leaving scenario titles alone passes
  silently. OpenFastTrace solves this by putting a revision number in the item id and
  reporting coverage of an older revision as *outdated*. Worth stealing.
- **The tree file(s)** — one file per capability, plus a top-level index of
  capabilities? Or a single file? (Leaning per-capability.)
- **Real starting point** — decide where OpenTDD lands relative to the reference repo
  (the earlier `worktree-turn-route` spec-binding work is a stale snapshot; main has
  moved on). Verify before building.
- **Then**: build the parser + the capability-file writer + the guard, TDD, using
  OpenTDD on itself.
