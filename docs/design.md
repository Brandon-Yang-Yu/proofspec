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

§12 cuts these three jobs into the capabilities that carry them.

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
| 8 | Mixed site — one `it` carries a Requirement/Scenario pair above it **and** tagged blocks inside it | the proof-site count is ambiguous | FAIL |

A proof site is a whole test, or a tagged block of assertions inside one — rules 4-7
apply to each site, not to each `it(`. A parameterised test (`it.each`) is one site
however many rows its table has. Rule 8 is the exception: it applies to the `it` as a
whole, because it is the rule that decides *which* of the two layouts in §13 is in play.

Two things the guard deliberately does **not** check, because they need judgement and a
person or an AI reading the co-located claim can supply it:

- that every row of a table reaches the same THEN (a row with its own outcome is a
  second scenario in disguise);
- that scenarios sharing a test really share its GIVEN/WHEN, rather than having been
  folded together to save an expensive setup.

Opt-in: a capability is enforced (rules 2, 3) once a test first tags it — not merely by
having a `.md`. A spec is authored before its tests, so a file with no tags yet is planned,
not built, and must not fail the build; the first tag switches enforcement on. Older suites
are not forced to retag all at once, and a tag whose capability has no file is left alone
too (the mirror case). *Earlier draft said "simply by having a `.md`", which would fail
every spec written ahead of its tests — see guard.md.*

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

## 12. The tool's capabilities

§6 lists the tool's jobs as a flat list. Cut along the data flow, they become six
capabilities — the top of OpenTDD's own tree, each able to carry its own requirements
and be proven by its own tests:

| Capability | Holds | Serves which of `spec.md`'s requirements |
|---|---|---|
| `test-scan` | test sources → `ProofSite[]`: tag extraction, Gherkin step parsing, proof-site boundaries, `it.each` as one site | R2, R3, the machine-checkable half of R1 |
| `spec-file` | the committed `.md`: section-tree read, and a write-back that replaces only the generated block | R4, R5 |
| `spec-tree` | scan result → the stable tree (line numbers stripped, sorted, duplicates detected), plus tree diff | R1, R3, R6 |
| `guard` | the rules of §7, their diagnostics, exit codes, opt-in enforcement | R6 |
| `locate` | current `file:line` computed on demand; rendering the tree | R5 |
| `cli` | commands, config, output formats | — |

Three notes on the cut:

- **`spec-tree` stays separate from `guard`** even though it looks like plumbing. It is
  the only place the stable-identity rule (§3.2) actually lands, and both `guard` and
  the write-back depend on it behaving identically. Fold it into `guard` and the two
  paths drift.
- **Language knowledge is confined to `test-scan`.** Everything downstream consumes
  `ProofSite[]` and never learns that TypeScript exists. That contract — not the
  parsing technique — is what keeps the core language-agnostic. v1 supports TypeScript
  only; a second language is a second scanner behind the same contract.
- **Delivery is CLI-only in v1.** `locate` ships as `opentdd where <scenario>` and
  `opentdd tree [--json]`. An MCP server is v2; `--json` is the seam it will sit on.

Two things deliberately *outside* the capabilities: the judgement checks named at the
end of §7 (they belong to a person or an AI reading the co-located claim), and the
plan-time `propose` flow (that stays with the `openspec` CLI, per §8).

**A capability requirement states behavior, never implementation.** The test is whether
it can be falsified by observing what the tool produces. "The scanner SHALL NOT read
`tsconfig.json`" fails it — you could only check that by reading the source or spying on
the filesystem, and it would still be satisfied by a tool that got the answer wrong. The
behavior hiding behind it is "a file whose types do not check SHALL yield the same proof
sites", which a test can hold to account. Implementation choices — the parser of §14, the
syntax of §13 — are recorded here in the design record, not as requirements. A drafted
requirement that names a library, a file format the tool reads for its own configuration,
or a performance target is nearly always an implementation detail wearing a SHALL.

**And it is written in plain English.** The whole method is a bet that a claim can be
made cheap to judge. Prose that has to be read twice spends exactly what the bet is
trying to save, so density is not a stylistic preference here — it is the thing failing.
The rules: one claim per sentence; the claim before its reason; a list written as a list;
no clause stacked behind an em-dash or a semicolon. Lead each requirement with one SHALL
sentence carrying the promise, then plain sentences for the detail. If a sentence needs a
second pass, it is two sentences.

## 13. Proof-site syntax

Settles the open question of how a scenario tagged on a block of assertions is written.
One rule:

> **The layer at which a `Requirement` + `Scenario` tag pair appears is the layer of the
> proof site.**

Above an `it` → the whole test is the proof site. On a statement inside an `it` → each
such statement opens a block proof site. Rule 8 of §7 forbids both at once.

**Layout A — one scenario, everything above the test.** The common case.

```ts
// Requirement: The guard fails the build on drift
// Scenario: A stale capability file fails the build
// GIVEN a committed capability file
// WHEN the tree regenerated from the tests differs from it
// THEN the guard fails and reports the difference, naming both the
//      requirement and the scenario that moved
it('fails on a stale capability file', () => { ... })
```

**Layout B — a shared action (§11 decision B).** Above the `it` sits only the shared
GIVEN/WHEN, carrying no identity; identity moves down to each block.

```ts
// GIVEN a document with one version
// WHEN a turn is posted
it('posting a turn', async () => {
  const res = await post('/turn')

  // Requirement: A turn streams the reply
  // Scenario: The reply is streamed as SSE
  // THEN the response is an SSE stream carrying the assistant tokens
  expect.soft(res.headers['content-type']).toBe('text/event-stream')

  // Requirement: A successful turn appends a version
  // Scenario: A successful turn appends one version
  // THEN exactly one new version is appended to the document
  const versions = await listVersions(docId)
  expect.soft(versions).toHaveLength(2)
})
```

The details that go with it:

- **Block boundary** — a block runs from its tagged statement to the statement before
  the next tagged one, or to the end of the `it` body. Untagged statements in between
  (`const versions = await …`) belong to the block they sit in.
- **Steps are bare keywords** — `// GIVEN`, `// WHEN`, `// THEN`. Not the `- **WHEN**`
  markdown of a `.md` file; that decoration is for the spec document, not for code.
- **Continuation** — a comment line that does not begin with a keyword continues the
  previous step. This is how a step runs to more than one sentence (spec.md R2) without
  needing AND.
- **`//` only.** No `/* */`. One shape keeps the parse surface minimal.
- **`// Capability:` is file-level**, one per file. Two capabilities in one file → split
  the file.
- **No `describe` inheritance in v1.** A `// Requirement:` may not be hoisted onto a
  `describe` as a default for the tests inside it. It would be convenient and it
  complicates rule 4 ("tags come in pairs"); useful before flexible.
- **`it.each` is one proof site**, whatever its row count.

## 14. Choosing the parser

**Decision: an AST scan, on `oxc-parser`. Parse only — no type checker, no `tsconfig`.**

The alternative was a line scanner over the raw text. Four reasons it lost:

1. **The hard part is free in an AST.** Cutting an `it` body into block proof sites
   (§13) is the hardest thing the scanner does. In an AST it is the body's `statements`
   array plus each statement's leading comments. A line scanner has to guess the
   boundary from indentation or "the next tag", and a wrong guess corrupts the bijection
   count — the one number the whole tool rests on.
2. **A line scanner is not the simple option.** To know whether a tag sits above an
   `it(` or above an `expect(` inside one, you must track brace depth, which means
   masking strings, template literals, regexes and comments — writing a bad JS lexer. A
   prototype was fed a decoy `it('x', () => {})` inside a string literal; the AST
   ignored it for free.
3. **Performance is not a trade-off.** 200 files / 112,200 lines parse *and* fully walk
   in 98 ms.
4. **Error-message quality.** An AST can say "the third statement of `it('posting a
   turn')`, line 30, has a THEN with no Requirement tag". A line scanner says "near line
   30". Since OpenTDD is used on itself from day one, that message is what we read every
   day.

Which parser, then. A ~90-line prototype was written twice — once on `typescript`'s
`createSourceFile`, once on `oxc-parser` — and run against two samples: an adversarial
one (a plain test, one `it` with two tagged assertion blocks, an `it.each`, the string
decoy) and an edge one (CJK capability names, CJK comments, an emoji, `await using`,
import attributes, `accessor`, a `static {}` block, private fields).

| | `typescript@5.9` | `oxc-parser@0.141` |
|---|---|---|
| Proof sites extracted, both samples | 4 / 2 | identical, field for field |
| CJK + emoji line numbers | correct | correct |
| Modern syntax | parses | parses, `errors: 0` |
| Single-file parse | 3.7 ms | 0.3 ms |
| Dependency size | 23 MB | 3.2 MB |
| Scanner source | 91 lines | 99 lines |

Two findings decided it.

**`typescript@7` no longer offers the API.** The current `latest` (7.0.2, the Go port)
exports only `lib/version.cjs` from its main entry; `createSourceFile` is gone. An AST is
reachable only through `typescript/unstable/ast` plus a `Program` that needs a tsconfig
and talks to the Go binary over IPC. So the TypeScript route means pinning `5.9`
forever — a version debt taken on for a feature that only ever parses.

**The reason to pay that debt evaporated.** The one advantage `typescript` had was that
`getLeadingCommentRanges` attaches comments to nodes for you; `oxc-parser` returns a flat
comment array with offsets. Writing that attachment by hand came to **18 lines** — and
the hand-written version is *stricter*, requiring a comment to be directly above its node
with no blank line between, which is exactly what spec.md R2 says and what
`getLeadingCommentRanges` does not enforce.

Costs accepted: `oxc-parser` is pre-1.0, and it ships a native binary per platform. Both
are hedged the same way — `test-scan` exposes only `ProofSite[]`, and the
`typescript@5.9` implementation already exists and produces identical output, so
reverting is a one-file change.

## 15. Open questions / next steps

- **Do requirement descriptions need a revision?** The guard compares titles and files,
  so editing a requirement's SHALL text while leaving scenario titles alone passes
  silently. OpenFastTrace solves this by putting a revision number in the item id and
  reporting coverage of an older revision as *outdated*. Worth stealing.
- **A capability index?** `spec.md` R4 settles one file per capability. Whether a
  top-level file also lists the capabilities is still open.
- **Real starting point** — decide where OpenTDD lands relative to the reference repo
  (the earlier `worktree-turn-route` spec-binding work is a stale snapshot; main has
  moved on). Verify before building.
- **Then**: build parser → capability-file writer → guard, TDD, using OpenTDD on itself.
  `test-scan` is the first capability built this way — 24 scenarios, the scanner on
  `oxc-parser` (§14), green. `spec-tree` is the second — 14 scenarios, §17, green. The
  `<!-- scenarios: generated -->` blocks of both are hand-filled for now; the bootstrap
  tags are cross-checked by a script that scans the tests and builds the tree, then
  compares it against the committed blocks — 38 proof sites, no collision, none unplaced —
  until `guard` can do it as a build step. **`guard` is next**: it has both halves it
  needs now, so the rules of §7 become exit codes over a `TreeBuild` and a `TreeDiff`.

## 16. The build pipeline

How a capability gets built, recorded as the `ship` skill so the steps never have to be
respelled. It is OpenTDD's own — not the reference repo's: no UI (this is a CLI library), no OpenSpec
(retired for our own build, §8; planning happens in Claude Code's plan mode instead).

The steps: **plan** (plan mode — the behavior gate, where a human confirms the scenarios
are the intent) → **tests, red** → **build to green** → **guideline review** (a fresh
subagent audits the diff against `docs/typescript-style.md`; it reports, the builder
fixes) → **completion check** (a fresh subagent confirms the code satisfies every
requirement and each test really pins its claim) → **archive the plan** (the *why* into
this record) → **wait for the human to say commit**.

The load-bearing idea is the same one the two review gates in the reference repo's `ship` carry: a
builder is a poor judge of their own fresh work, so the review hands off to a reader who
never watched the code get written. Building `test-scan` this way earned its keep — the
guideline pass caught a real double-reporting bug, and the completion pass found three
load-bearing behaviors (the lone-tag no-site rule, the own-line comment strictness, an AND
inside a block) that had no scenario until it named them.

*Closed since the first draft:* the missing tool requirement (now `spec.md` R5 and R6);
the proof-site syntax (§13); the parser choice (§14); the build pipeline (§16);
`test-scan`, the first capability built under it; and `spec-tree`, the second (§17).

## 17. The stable tree

`spec-tree` turns `ProofSite[]` into the tree `capability → requirement → scenario title →
file` and compares two trees. It is pure data: no file I/O, no Markdown (that is
`spec-file`), no exit codes (that is `guard`). Two functions — `buildTree`, `diffTree`.

**Identity is `(capability, requirement, scenario title)`.** This is where §3.2 lands as a
machine key. Line numbers and Gherkin steps are excluded, and that exclusion is the whole
point: a line shift or a reworded step must not read as a change to the spec. §4's
storage/delivery split says line numbers are delivered and never stored; this is the code
that makes it true.

**A rename is not a kind of difference.** The first draft of the capability spec listed
four — added, removed, renamed, moved. Renamed came out, because it is not derivable: the
title *is* the identity, so a changed title is a different scenario, and no comparison of
two trees can tell a rename from one deletion plus one unrelated addition. Claiming
otherwise would have meant a heuristic pretending to be a fact. Three kinds, and a rename
reads as one removed and one added.

**A site with no capability is set aside, not dropped.** The scan reports such a site with
`capability: undefined` and leaves the verdict to `guard` (§7 rule 5). The tree cannot key
it, so `buildTree` returns it in `unplaced`. The alternative — have `guard` filter them
before building — was rejected: the build is the one pass that already walks every site,
and a proof site that silently vanished between the scan and the tree is exactly the kind
of hole this tool exists to close.

**A collision keeps the scenario once and names every site.** Deduplicating quietly would
hide a broken bijection, which is a modelling error the author has to see. But the tree
must stay reproducible even while broken, so the surviving entry takes the first file by
name rather than the first the scan happened to reach.

**Sorting compares UTF-16 code units, not `localeCompare`.** A tree regenerated in CI has
to sort the way the committed one did, and a locale-sensitive comparison would make the
machine part of the answer.

What the two review gates (§16) earned this time: the guideline pass caught the identity
key duplicated across the build and the diff — two definitions of the one concept that
could have drifted into a tree and a comparison that disagreed. The completion pass found
four determinism holes that no test defended, the load-bearing one being the file chosen
for a collided scenario: the code was right, but a one-line edit to "first site scanned"
would have passed every test while making the committed tree differ between machines.
