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
- ~~**A requirement declared twice.**~~ *Settled: the guard warns (§18). A capability file
  with two `### Requirement: X` headings reads as two requirements of that name, and the
  write-back records the same entries under both. That is deterministic and harms nothing
  downstream, so rejecting it would fail the build over a state the tool already handles.
  But two headings of one name are almost always an editing slip, and which one is meant to
  survive is the author's call — so the guard reports it as a warning and leaves the fix to
  the person or AI reading the report, rather than inventing a rule.*
- **Then**: build parser → capability-file writer → guard, TDD, using OpenTDD on itself.
  `test-scan` is the first capability built this way — 24 scenarios, the scanner on
  `oxc-parser` (§14), green. `spec-tree` is the second — 14 scenarios, §17, green.
  `guard` is the third — 16 scenarios, §18, green. `spec-file` is the fourth — 16
  scenarios, §19, green — and with it **OpenTDD runs on itself end to end**: scan the
  tests, build the tree, read the six committed `specs/*.md`, guard the two against each
  other. 70 proof sites, no collision, none unplaced, guard `pass`, and the write-back
  reproduces all six committed files byte for byte. **`cli` is the fifth** — 11 scenarios,
  §20: it opens the files, wires the four capabilities together, and turns a `GuardReport`
  into an exit code a build can act on. With it the blocks stop being hand-filled — `write`
  fills them: run on OpenTDD's own repo it changed only `specs/cli.md`, every other block
  regenerating byte for byte, and `check` returns `pass`. OpenTDD now runs on itself end to
  end, write-back included.

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
`test-scan`, the first capability built under it; `spec-tree`, the second (§17); `guard`,
the third (§18); `spec-file`, the fourth (§19); and `cli`, the fifth (§20), with which the
tool runs on itself including the write-back.

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

## 18. The guard

`guard` turns the rules of §7 into a verdict. It takes the scan and the committed tree and
returns a `GuardReport` — a `status` of `pass` or `fail`, and a list of findings, each
naming what is wrong and where to look. One function, `guard({ scans, committed })`.

**The verdict, not an exit code.** §12 assigns "exit codes" to this capability, and the
first build took that literally: the report carried `exitCode: 0 | 1`. A number a process
exits with is not a fact about a spec tree, and the type that holds it says two lines above
that the CLI chooses the output. So what this capability owns is the verdict an exit code
is made from, and the CLI turns it into a number at the boundary where processes live.

**It reads no files.** `spec-file` is not built yet, and when it is it should stay the one
place that knows the Markdown format, so the guard takes the committed capability files as
a `SpecTree` rather than as paths. This is the same cut `spec-tree` took: pure data in,
pure data out. The alternative — give the guard a small Markdown reader of its own to make
it runnable sooner — was rejected for the reason §17 rejected two tree builders: two
readers of one format drift, and then the tool that writes a file and the tool that
verifies it disagree about the same bytes.

**One input carries both halves of a capability file.** The guard needs to know what a file
*declares* (for the coverage rules) and what it *records* (for the comparison). A
requirement declared and not yet proven is simply a `RequirementNode` with no scenarios, so
a single `SpecTree` says both and no second input is needed.

**Opt-in has a narrower scope than "leave the capability alone".** §7 says a capability is
enforced once a test tags it. Read too broadly that would mean a capability file whose
tests were all deleted passes silently, which is the exact drift the guard exists to catch.
So the gate is cut three ways: the *comparison* applies to every capability that has a
file, because a file with recorded entries is built and not planned; the *requirement
rules* wait for the first tag; and a capability with no file at all is dropped from the
regenerated tree before the comparison, so its scenarios do not all read as added. The
bijection rule sits outside the gate entirely — a scenario claimed twice is a fault in the
tests themselves, not a claim about a capability file, so it fails wherever it is tagged.

**A rename came out of this spec too.** `specs/guard.md` still asked the report to name a
difference as "renamed", written before §17 settled that a rename is not derivable. Left
in, it would have forced a heuristic pairing one removal with one addition and presenting
the guess as a fact. Three kinds, and a rename reads as one removed and one added.

**Every failure carries a line except the ones that cannot.** The first build had
`scenario-added` and `scenario-moved` carrying only a file, because the tree it compares
deliberately holds no line. But the *site* is right there in the scan, so the guard joins
the difference back to the proof site that caused it. What is left without a line is left
without one honestly: a requirement nothing proves has no site by definition, and a
scenario the tests no longer prove has none either. Requirement 7's sentence was widened to
say that, since it had claimed a line for failures that can never have one.

**Determinism became a requirement rather than an unrequested feature.** The report sorts
its findings, which nothing in the spec had asked for — the same shape of hole §17 records
in `spec-tree`, but the other way round: there the code was required and untested, here it
was neither. Deleting the sort was the wrong fix, because without it the order follows
whatever order the CLI walked the files, and a report that reorders itself run to run
cannot be diffed. So the promise is now written down and proven, and the rank of each kind
is a `Record` over the union — adding a finding kind without ranking it is a compile error.

What the two review gates (§16) earned this time. The guideline pass found seven
deviations, the load-bearing one an ordering key built by stringifying a whole finding:
the report's order depended on the property order of six object literals, so reordering
fields in one of them would have silently changed the output. The completion pass found the
missing lines above, the undeclared determinism, and a rule the code had invented — it was
suppressing the "no Gherkin above this site" warning for sites the tree could not place,
which no requirement asked for and no test defended. It also found something no fix
applies to, worth recording: because "declared" means "present in the committed tree", a
tag naming an undeclared requirement *always* also produces an added-scenario difference,
so that rule can never be the sole cause of a failed build. Its whole value is the
diagnostic — "this tag names a requirement the file does not declare" instead of "this
scenario is not recorded" — which is exactly the reason §7 lists it separately.

Two more came out of the human's read of the borderline calls the guideline pass raised.
The exit code above, and a `Map.get` returning `undefined` that meant two different things
in one file: "this capability has no committed file" in one rule and "no test tags this
capability yet" in the other. Both are states the rules turn on, not absences, so both are
named now — `hasCommittedFile` for the first, and a `Coverage` union whose `untagged` case
*is* the opt-in switch for the second.

**A second warning, and why it is a warning.** §15 left open what to do about a capability
file that declares one `### Requirement:` heading twice. The guard now reports it — as a
warning, joining `no-steps` as the second finding that does not fail the build. The reason
it warns rather than fails is that the state is already handled: the reader records the same
entries under both headings, the tree keys a scenario by its title so the duplicates
collapse, and nothing downstream reads them wrong. Failing the build would punish a state
the tool copes with. But two headings of one name are almost always an editing slip, and
which one is meant to survive is prose the author owns — the same reason the write-back
never authors a heading. So the guard says what it sees and leaves the fix to the person or
AI reading the report. The tool's output is that reader's input; a warning hands them a
decision, a failure would take it away. The completion pass earned two things here: the
headline promise — *one finding per repeated name, however many times it was written* — was
unproven until a three-times case was added, and a duplicated requirement that nothing
proved emitted `uncovered-requirement` twice, one failure doubled for a single cause, now
deduplicated so the repeated heading is reported once as the warning it is.

## 19. The capability file

`spec-file` is the format: it reads a committed capability `.md` into its requirements and
what they record, and it writes the recorded entries back without touching anything else.
Two functions — `readCapabilityFile`, `updateScenarioBlocks`. With it the tool runs on
itself, because it is the last piece between `guard` and a real capability file.

**Text in, text out. It opens nothing.** The same cut `test-scan` takes (it is handed a
source, never a path) and `guard` takes (it reads no files). The filesystem belongs to
`cli`, and keeping it there is what lets every test of this capability be a string
compared against a string.

**One format, defined once, facing both ways.** The reader and the writer are separate
jobs but not separate formats, so what a heading is, where a block starts and ends, and
what an entry looks like are decided in one file that both go through. §17 rejected two
tree builders and §18 rejected a second Markdown reader for the same reason; this is that
rule applied inside the capability rather than across it. The completion check found the
one place it had not been applied and it cost exactly what the rule predicts: the reader
and the writer had each worked out where a block ends, and for a block whose closing
marker was missing they disagreed by one line — the reader dropped the last entry the
writer went on to rewrite. The block now carries two ranges decided together, the lines it
records and the lines the write-back replaces, so the reader parses exactly what the writer
replaces.

**A fence nobody closed is not a fence.** A capability file may show an example of itself,
and a heading or a marker inside a code fence is not one. Markdown says an unclosed fence
runs to the end of the document; that reading would leave the write-back appending a block
below it on every run, growing a file it can never bring to rest. Only a fence that is
closed again masks anything. The rule was chosen for convergence over conformance, because
the guard compares what it regenerates against what is committed and a file that never
comes to rest fails a build nothing can fix.

**A marker is a line that is nothing but the marker.** Matching one loosely would mean
writing an indented marker back unindented — a line outside the block's content, and not
the write-back's to change. Left as prose it is at least read the same way by both
directions.

**Both functions are total.** No `Result`, no error list. A line inside a block that is not
an entry records no scenario; a block with a lost marker is written back closed. Nothing is
silently swallowed, because every one of these states ends in front of the guard: an entry
that fails to parse is a scenario the file no longer records, which the guard reports as
unrecorded and the build fails on. An error channel here would be a second way of saying
what the guard already says.

**Reading gives back the description, and sorts.** The description is prose no consumer
needs yet, but a read that silently discarded half the file would be a lie, and `locate`'s
"the whole tree can be read at once" is the named consumer. Requirements come back in name
order and entries in title order — the order `SpecTree` promises — so what is read *is* a
branch of the tree, and the type is built on `CapabilityNode` rather than restated so it
cannot quietly stop being one.

**The capability's name comes from the caller, not the file's title.** The CLI knows the
file it opened. Making an H1 load-bearing would let a typo in a heading detach a whole
capability from the tests that prove it.

**The writer sorts what it is handed** rather than trusting the tree to arrive sorted. The
same shape as §17's collision-file decision: the file coming out identical on every machine
is a promise the writer can keep on its own, instead of one it makes about its caller.

What the two review gates (§16) earned this time. The guideline pass found nine, the
load-bearing one two functions threading a lines array beside the fence mask built from it
— an invariant nothing declared, where a mask from one file could be paired with another's
lines; both now travel as one value. It also caught `recorded` naming two opposite things
in one capability (what the file already holds, and what the caller wants held) and a
comment in the test support that was simply false. The completion pass found the growing
file, the reader/writer disagreement above, and three tests that did not bite: the title
holding an entry separator passed with `indexOf` in place of `lastIndexOf`; and the two
ordering claims that say "on any machine" passed with `localeCompare` in place of
`compareStrings` — the exact hole §17 and §18 each record finding, found a third time,
which is what a fixture chosen for readability rather than for adversariality costs. Each
fix was checked by breaking the code again and watching the test fail.

Two of its findings became scenarios rather than fixes, and one became neither: a
requirement declared twice is recorded under both headings, which no requirement asks for
and nothing downstream minds, so it is an open question in §15 rather than a rule invented
here.

## 20. The commands

`cli` is the two commands people and CI run — `check` and `write` — and the one capability
that owns the filesystem and the process. Everything else in OpenTDD takes a string and
returns a value; `cli` is where the strings come from and where a verdict finally becomes an
exit code. With it the tool runs on itself for real: `write` fills the generated blocks the
four capabilities had until now filled by hand, and `check` is the gate a build fails on.
Run against its own repo, `write` changed only `specs/cli.md` — every other capability's
block regenerated byte for byte — and `check` returns `pass`.

**A verdict, not an exit code — again.** §18 stopped `guard` short of an exit code, and
`cli` keeps that boundary one level further out. A command returns an `Outcome` — `checked`
with a report, `wrote` with the files it changed, or `cannot-run` with a reason — and
`render` turns it into the number a process exits with. The exit code lives at the process
edge, where processes live, and nowhere inside the value the commands produce.

**`cannot-run` is a case, not a missing report.** R2 asks CI to tell "your spec has drifted"
from "I could not read my inputs", so the two are different non-zero codes: drift is 1,
cannot-run is 2. Modelling the second as its own `Outcome` case rather than an empty report
is what makes the distinction impossible to lose — a caller reads which happened from the
tag, not by inferring it from a number. A directory that cannot be listed becomes that case
at the boundary: `discover` catches the read and returns a reason rather than throwing,
which is rule 10 applied to the one capability that has real I/O to fail at.

**Two commands, two functions.** `check` reads and reports; `write` records. They share how
a repo is read, but each is its own function rather than one entry with a mode, so neither
does two things and the check has no path that could ever write. That last point is R1 made
structural: `writeFile` is imported once and reachable only from `write`, so a check cannot
fix what it finds however much the repo has drifted.

**It re-implements nothing.** `cli` is wiring: `scanSource` over each test, `readCapabilityFile`
over each committed file, `buildTree`, `guard`, `updateScenarioBlocks`. The format knowledge
stays in `spec-file`, the language knowledge in `test-scan`, the rules in `guard`. Even the
capability's name is read the way §19 says to — from the filename the caller opened, never an
H1 — so a typo in a heading cannot detach a capability from its tests.

**Directories, walked, not globbed.** The two locations are directories, and the tests are
found by a recursive walk for `*.test.ts` rather than a glob. A walk needs no glob grammar
and no Node-version bet, and the files come back sorted by name, because a scan that walked
its files in a different order on another machine could render the same tree differently —
the determinism §17 and §18 keep.

**Flags, no config file.** R3's two halves — the conventional layout needs no configuration,
and both locations are configurable — are met by defaulting the two directories to `specs/`
and `tests/` and letting flags override them. A config file was not built: there is no
compiler to point at and no project to describe, so a file would be machinery the requirement
does not ask for.

**JSON is the same answer, not a second one.** `check --json` prints the report; the human
form is `describeFinding` over the very same findings. Both are projections of one `Outcome`,
so they cannot carry different content — which is the point of R4, that another tool reads the
answer rather than parsing the terminal.

What the two review gates (§16) earned this time. The guideline pass found four, the
load-bearing one a boolean parameter (`listDir(dir, recursive)`) — the shape §4 bans, and out
of step with every other helper in the repo, which passes flags in an options object; a
`Locations` type declared and then duplicated field for field inside `RunOptions` rather than
composed; two sibling `read…Files` functions written one `async` and one not; and a test
fixture re-sorting with a hand-rolled comparator instead of the shared `compareStrings` —
which was not only style but correctness, since the fixture's order has to match the
write-back's byte for byte. The completion pass confirmed all five requirements were genuinely
satisfied and then found the tests thinner than the requirements: R4 says *every* command and
*the same content as the form written for a person*, but only `check`'s JSON was pinned and
nothing tied it to the human form — so a text renderer that dropped its findings would have
passed. Two scenarios closed it: the JSON test now asserts the human form names the same
finding, and a second proves `write`'s answer is JSON too. R5's "changes nothing else" was
proven only within one file, so a third scenario writes a repo of two capability files and
holds the untouched one byte for byte.

One finding was first left as an observation and then reversed on a second read, which is
worth recording as the reversal it was. The build shipped with `write` building its tree from
the scan's sites and *ignoring* the scan's errors, on the argument that `check` is the gate
that catches them and the workflow is check-then-write. That borrowed §19's stance — let a
bad input surface at the guard rather than erroring early — but the borrow does not hold.
§19's functions are pure and total: they only transform text, so nothing is lost and the
guard sees everything afterward. `write` is not pure. It changes files, and the guard runs
*after* the change, so "the gate catches it later" catches it too late — the mutation has
already landed, built from partial sites (a `mixed-placement` test contributes no site at
all, so its scenario silently drops out of the block). Worse, nothing enforces the
check-then-write order: a person can run `write` on its own. So the rule was added: `write`
refuses when the scan reports any error, changes nothing, and says where to look. A mutating
command earns the invariant a reader would assume it already had — *it only changes files in
a repo it could fully read* — and that is worth more than staying symmetric with the pure
capabilities below it. Proven by a scenario; `check`'s own error reporting is untouched.
