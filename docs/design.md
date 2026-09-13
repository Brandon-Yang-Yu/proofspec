# ProofSpec — design record

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

6. **ProofSpec does not care which layer a test is (api / component / e2e / unit).**
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

**Line numbers are delivered, never stored.** The tool finds a scenario by its
`// Scenario: <title>` tag (titles are unique within a requirement, per the bijection)
and reports the current line — §14 settles the mechanism as an AST scan, not a grep. Because line numbers never enter the stored file,
editing a test never produces a false "spec drifted" diff.

## 5. Where each piece lives (zero duplication)

| Thing | Home | Written by |
|---|---|---|
| requirement description (SHALL) | the capability `.md`, above the generated marker | human |
| scenario behavior (Gherkin WHEN/THEN) | the test, above its `it` | human |
| scenario location (title → file) | the capability `.md`, inside the generated marker | tool |

Shape of a capability file:

```markdown
# proofspec

### Requirement: Tests are the source of truth for behavior
The tests SHALL be the one place that says how the product behaves. …   ← human

<!-- scenarios: generated -->
- "A scenario is written above the test that proves it"   → tests/proofspec/parse.test.ts
- "One scenario is proven by exactly one test"            → tests/proofspec/guard.test.ts
- "Behavior is not duplicated outside the test"           → tests/proofspec/guard.test.ts
<!-- /scenarios -->
```

Note the generated block stores **title + file only, no WHEN/THEN** — copying the
Gherkin in would violate principle 1 ("behavior lives only in the test"). The model
is self-consistent.

## 6. The tool's jobs

A single script (`proofspec`), in the spirit of an MCP resolver:

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
| 9 | Term that promises — a `### Term:` definition contains a `SHALL` | a definition smuggled a requirement past the review gate | FAIL |
| 10 | Term not in capitals — a term's name is not written in capitals (words separated as used) | the exact-form convention is unenforceable on a lowercase name | FAIL |
| 11 | Term defined twice — two `### Term:` sections carry the same name | the vocabulary means two things; the matcher cannot tell which | FAIL |

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

The term rules (9–11) sit outside opt-in, on purpose. A glossary file may hold nothing but
terms — no requirements, so no tags, ever — and leaving its rules off until a test arrives
would mean the one file whose whole job is the vocabulary is the one file never checked for
it. Terms are global across files (§34), so their rules are global too.

## 8. Relationship to OpenSpec

**Decision: thin layer, not a fork.** Keep the published OpenSpec tooling for the
plan-time proposal flow (it is maintained, and we don't want to own it). That flow is
the `/opsx:propose` → `/opsx:apply` → `/opsx:archive` slash commands OpenSpec installs
into the coding agent; the `openspec` CLI itself has no `propose` verb — it scaffolds,
validates, and archives. ProofSpec is a small tool around it.

Findings from reading the OpenSpec source (`@fission-ai/openspec` 1.6.0, MIT):

- **~32,400 LOC across 171 files** (`src/`, at the v1.6.0 tag), but the reusable kernel
  (parsers + validation + schemas) is only **~1,700 LOC**. The other ~30k is stores, shell completions, a
  templating engine, telemetry, legacy migration — none of it needed.
- The parser turns a `spec.md` into `{ requirements: [{ text, scenarios: [{ rawText }] }] }`.
  It **discards scenario titles and line numbers** — it is built for validation, not
  for the title+location indexing ProofSpec needs. So we don't lift the file; we borrow
  two ideas: the nested-header "section tree" walk, and the code-fence mask (so a
  `####` inside a ``` block is not mistaken for a header).
- **`openspec validate` requires every requirement to have ≥1 scenario** (a hard
  ERROR). So a requirements-only `spec.md` is impossible under the tool. Therefore
  ProofSpec **retires `openspec/specs/` as the durable store** — OpenSpec is used only
  to author change proposals (which do carry scenarios and validate fine); ProofSpec
  owns the archive→tree step instead.

So the "base" we build on is the *format* (Requirement + Scenario/WHEN/THEN) and two
parsing tricks — not the 34k-line binary.

## 9. Workflow

ProofSpec's lifecycle, mapped onto the OpenSpec verbs:

1. **Confirm the requirement** — establish the high-level promise (product-reviewed,
   pre-code). OpenSpec's `/opsx:propose` fits here (a slash command run in the coding
   agent — the `openspec` CLI has no `propose` verb).
2. **Refine into scenarios** — break the requirement into detailed conditions.
3. **Apply** — create the test for each scenario; the scenario's Gherkin is written
   above its `it`. The requirement's `.md` gets its scenario locations written back.

## 10. Draft — ProofSpec's own top-level requirement

**Superseded by [`docs/spec.md`](spec.md)**, which carries the finalized requirements.
Kept here as the record of the first draft; where the two disagree, `spec.md` wins.

```markdown
## proofspec

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

The one-scenario-one-test rule was a bet. A production repo that predates ProofSpec
(the reference repo below) settles it, because that repo already
runs a cruder version of this idea: every `it` carries a `// Spec: <capability> › "<title>"`
tag, and `tests/spec-coverage.test.ts` (103 lines) checks both directions — every tag
names a real scenario, and every scenario of an *enforced* capability has at least one
tag. It is ProofSpec's guard minus rule 6.

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

And a live example of the problem ProofSpec exists to solve: in the reference repo the
same behavior was, at the time of this audit, written in **three** places —
`openspec/specs/agent-chat/spec.md`, a full Gherkin `Feature` block in
`docs/behaviors/agent-chat.md`, and a prose summary at the top of the test file. That was
the first thing worth migrating. *(Since done: its `specs/*.md` are now ProofSpec
capability files with generated scenario blocks, its tests carry `// Capability:` tags,
and the `openspec/` and `docs/behaviors/` copies are gone.)*

## 12. The tool's capabilities

§6 lists the tool's jobs as a flat list. Cut along the data flow, they become six
capabilities — the top of ProofSpec's own tree, each able to carry its own requirements
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
- **Delivery is CLI-only in v1.** `locate` ships as `proofspec where <scenario>` and
  `proofspec tree [--json]`. An MCP server is v2; `--json` is the seam it will sit on.
  *(§21 revised this: `locate` shipped as a library, and the commands as built are
  `check` / `write` / `render` — `where` and `tree` remain a later `cli` change.)*

Two things deliberately *outside* the capabilities: the judgement checks named at the
end of §7 (they belong to a person or an AI reading the co-located claim), and the
plan-time propose flow (that stays with OpenSpec's `/opsx` commands, per §8).

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
   30". Since ProofSpec is used on itself from day one, that message is what we read every
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
- **Real starting point** — decide where ProofSpec lands relative to the reference repo
  (the earlier `worktree-turn-route` spec-binding work is a stale snapshot; main has
  moved on). Verify before building.
- ~~**A requirement declared twice.**~~ *Settled: the guard warns (§18). A capability file
  with two `### Requirement: X` headings reads as two requirements of that name, and the
  write-back records the same entries under both. That is deterministic and harms nothing
  downstream, so rejecting it would fail the build over a state the tool already handles.
  But two headings of one name are almost always an editing slip, and which one is meant to
  survive is the author's call — so the guard reports it as a warning and leaves the fix to
  the person or AI reading the report, rather than inventing a rule.*
- **Then**: build parser → capability-file writer → guard, TDD, using ProofSpec on itself.
  `test-scan` is the first capability built this way — 24 scenarios, the scanner on
  `oxc-parser` (§14), green. `spec-tree` is the second — 14 scenarios, §17, green.
  `guard` is the third — 16 scenarios, §18, green. `spec-file` is the fourth — 16
  scenarios, §19, green — and with it **ProofSpec runs on itself end to end**: scan the
  tests, build the tree, read the six committed `specs/*.md`, guard the two against each
  other. 70 proof sites, no collision, none unplaced, guard `pass`, and the write-back
  reproduces all six committed files byte for byte. **`cli` is the fifth** — 11 scenarios,
  §20: it opens the files, wires the four capabilities together, and turns a `GuardReport`
  into an exit code a build can act on. With it the blocks stop being hand-filled — `write`
  fills them: run on ProofSpec's own repo it changed only `specs/cli.md`, every other block
  regenerating byte for byte, and `check` returns `pass`. ProofSpec now runs on itself end to
  end, write-back included. **`locate` is the sixth and last** — 7 scenarios, §21: the
  delivery half of §4, resolving a scenario's current `file:line` and the whole tree's
  positions on demand, as a library (the `where`/`tree` commands are a later `cli` change).
  With it every capability in ProofSpec's own tree is built. *(The per-capability counts
  above are ship-time snapshots; the tree has since grown — as of the §22–§23 work it
  stands at test-scan 24, spec-tree 14, guard 17, spec-file 18, cli 18, locate 17 —
  108 scenarios, 129 tests, still green.)*

## 16. The build pipeline

How a capability gets built, recorded as the `ship` skill so the steps never have to be
respelled. It is ProofSpec's own — not the reference repo's: no UI (this is a CLI
library), no OpenSpec
(retired for our own build, §8; planning happens in Claude Code's plan mode instead).

The steps: **plan** (plan mode — the behavior gate, where a human confirms the scenarios
are the intent) → **tests, red** → **build to green** → **guideline review** (a fresh
subagent audits the diff against `docs/typescript-style.md`; it reports, the builder
fixes) → **completion check** (a fresh subagent confirms the code satisfies every
requirement and each test really pins its claim) → **archive the plan** (the *why* into
this record) → **wait for the human to say commit**.

The load-bearing idea is the same one the two review gates in the reference repo's
`ship` carry: a
builder is a poor judge of their own fresh work, so the review hands off to a reader who
never watched the code get written. Building `test-scan` this way earned its keep — the
guideline pass caught a real double-reporting bug, and the completion pass found three
load-bearing behaviors (the lone-tag no-site rule, the own-line comment strictness, an AND
inside a block) that had no scenario until it named them.

*Closed since the first draft:* the missing tool requirement (now `spec.md` R5 and R6);
the proof-site syntax (§13); the parser choice (§14); the build pipeline (§16);
`test-scan`, the first capability built under it; `spec-tree`, the second (§17); `guard`,
the third (§18); `spec-file`, the fourth (§19); `cli`, the fifth (§20), with which the
tool runs on itself including the write-back; and `locate`, the sixth and last (§21), the
delivery half of §4 — with it all six capabilities are built.

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

**Reading gives back the description, and sorts one half of the file.** The description is
prose no consumer needs yet, but a read that silently discarded half the file would be a lie,
and `locate`'s "the whole tree can be read at once" is the named consumer. Entries come back
in title order — the order `SpecTree` holds them in — so what is read *is* a branch of the
tree, and the type is built on `CapabilityNode` rather than restated so it cannot quietly stop
being one. Requirements come back in the file's own order; §33 says why that half is not the
read's to sort.

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
that owns the filesystem and the process. Everything else in ProofSpec takes a string and
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
structural: `writeFile` is imported once and reachable only from the commands that record —
`write` and, since §22, `render` — never from `check`, so a check cannot fix what it finds
however much the repo has drifted.

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

## 21. Locating a scenario

`locate` is the sixth and last capability, and the **delivery** half of the split §4 makes.
The committed files store what is stable — a scenario's title and the file it is proven in;
its *line* moves the instant anyone edits above the test, so it is never written down.
`locate` is where the line comes back: it reads the current `file:line` from the proof sites
as they stand, and it delivers the whole tree with those positions attached. Nothing is
regenerated and no file goes stale, because the answer is a pure function of the sites passed
in — the same stance the codebase-memory index takes, resolving a symbol's range fresh rather
than hard-coding it.

**Two answers, both values.** `locate(sites, identity)` returns `found` with a `file:line` or
`missing` naming the identity it looked for — a discriminated union, not a nullable position,
so a caller has to branch and a scenario that is not there can never be reported as a nearby
one. A confident wrong location costs more than none: it sends the reader to the wrong test to
judge the wrong claim. `locateTree(tree, sites)` walks `spec-tree`'s stable tree and adds only
the live line to each scenario, so the grouping and ordering rule stays in `spec-tree` and is
not built a second time — the same reason §17 kept one tree builder.

**A library, not the commands — yet.** §12 says `locate` "ships as `proofspec where` and
`proofspec tree`", but those are a `cli` concern, and `cli` shipped (§20) with only `check` and
`write`. `locate.md`'s three requirements are pure data behaviour — find a position, deliver
the tree — with no command, config, or exit code in them. So `locate` lands as the library
this ship, and wiring `where`/`tree` through `discover`/`render` is a later change against
`cli.md`. That keeps the `guard`(library)/`check`(cli) boundary the tool already draws.

**One comparator, found a fourth time.** A scenario proven at more than one site resolves to
the first by file then line — the choice `spec-tree` makes for a scenario's file (`fileOf`,
`sortPlacements`) and `guard` makes for its placement (`comesFirst`). `locate` needed it too,
and building it a third private copy is exactly the drift §17, §18 and §19 each caught in
`compareStrings`: a rule written in three places, each with a comment insisting the three
agree. So the guideline gate's flag was taken rather than deferred, and the tie-break was
hoisted into `spec-tree` as `comparePlacements`, over the exported `Placement`; `guard`,
`spec-tree`'s own `sortPlacements`, and `locate` now all call it. The rule that decides which
site a collided scenario points at is written once, next to the identity it orders.

What the two review gates (§16) earned this time. The guideline pass found no clear
deviation but three borderline calls: the triplicated comparator above (hoisted, on the
human's call, rather than left as the plan had scoped it); a private `Position` type
re-declaring `Placement` field for field (folded into the hoist); and a test-helper branch
distinguishing "key absent" from "present but `undefined`" to force an unplaced site no test
asked for (simplified to `??`, YAGNI). The completion pass confirmed all three requirements
genuinely satisfied and five of six scenarios pinned, then found the sixth's hole: R3 promises
each scenario's *current* file, and the code delivers it — overriding the tree's stored file
with the live site's — but both tree tests held the file constant, so a regression to reading
the stored file would have passed green. It is the exact hole §4 exists to prevent: a tree
that "simply is the committed files". Closed by a seventh scenario, the file-analogue of the
line one — a tree built when a scenario was proven in one file, located against sites proving
it in another, must carry the new file. With `locate` green, ProofSpec's own tree is complete:
all six capabilities built, on itself, end to end.

## 22. Rendering the readable site

The committed files are not meant to be read straight. §4 stores a scenario's title and file
and nothing else, and §5 keeps the Gherkin out on purpose — a second copy is the drift the
tool exists to stop. So a person opening `specs/guard.md` sees *which* scenarios exist, never
*what they say*. `render` is the readable view the split always promised but nothing had yet
produced. It writes a `build/`: an index, one page per capability, and one code page per test —
every requirement's description, every scenario's Gherkin, and every proof's code and current
position, pulled live from the tests. `build/` is a generated output, named the way a build
tool names one, and gitignored — never committed, because a committed copy would be the very
drift the tool exists to stop the moment a test changed and no one re-ran `render`.

**One page per capability, not one document.** The first cut was a single `SPEC.md`. Read in a
static-site renderer it was a 46-minute scroll, and it left the explorer with one file to list.
A capability is the unit a reader browses, so it became the unit the site splits into pages,
with an index that links them; the explorer then *is* the capability list. The shape was found
by reading the render, not by guessing it — the same dogfooding §20 describes, one screen at a
time. §24 later added the one-document view back *beside* the pages, for the reader who is not
browsing.

**The proof travels with the claim.** A scenario's whole point (§1) is that its proof can be
read *against* the claim. So each test is a code page, and each proof a snippet of exactly its
lines, headed by its scenario, carrying that scenario's Gherkin, then the code — claim above
proof, so a reader judges whether the test does what the claim says without leaving the page.
Every scenario on a capability page links to its snippet. The snippet is the proving lines
only, so the pages stay short and a reader lands on the proof, not the top of a file.

**The anchor reads as the scenario.** A snippet's heading is its scenario title, so its slug is
a readable anchor (`#a-scenarios-position-is…`), not a bare `#l14`. `render` computes that slug
with the rule the renderer uses — lower-case, drop punctuation, spaces to hyphens, github-slugger
for the plain-English titles the tests carry — so the fragment a scenario links to and the id its
heading gets are the same string. This is the one place `render` must agree with the site's
renderer byte-for-byte, so it was checked against every title in this repo before it was trusted.

**And the path is the page's, not the test's.** The fragment was right for a long time while the
path in front of it was wrong: the link read `tests/x.test.ts#a-scenario`, but the page it pointed
at is written as `tests/x.test.ts.md`, so every scenario link in the site was dead — all 298 of
them, the core promise of `render` broken in a way no test caught, because both tests asserted the
string the code happened to produce. `codePagePath` now spells that path once: `renderCodePages`
names the file it writes with it and `renderScenario` links with it. That makes the two *spellings*
agree; it does not make the link *resolve*, which still rests on the caller handing `render` the
tests the sites were scanned from (§20's `run`). The test pins the resolution instead, asserting
the linked page is among the pages the render returns.

**It does not violate principle 1, because it stores nothing.** The Gherkin and the code are
*delivered*, the way `locate` delivers a line — read from the tests each run, written to an
output a person reads, never back into the committed files. `build/` is a product, not a source;
`check` never reads it, and it is gitignored so it never enters the repo.

**It bypasses the stable tree.** `spec-tree` strips the steps by design — a scenario's identity
is its title, so the tree cannot carry the Gherkin or the source. `render` therefore joins the
committed *descriptions* (from `spec-file`) to the raw scan *sites* (from `test-scan`, which alone
keep the steps and the line span), keyed by identity. It is the one delivery path that reads a
site's steps, so it is the one that must not go through `buildTree`.

**No seventh capability.** §12 already assigns "rendering the tree" to `locate`; this is the
richer render of that same delivery concern, so it lands in `locate` with the command in `cli`,
and the count stays six. The identity→site collision rule `locate` already had is now
`firstSiteByIdentity`, shared with the render rather than copied — the same shared-not-copied
stance the comparators take, the render keeping the whole site where `locate` kept only the
placement.

**It writes a directory and always rewrites.** Unlike `write`, which skips a file whose bytes
would not change, `render` rewrites the whole `build/` every run: it is an output, not an input
the tool reads back, so there is nothing to leave untouched. Drift is shown, not dropped — a
scenario recorded but proven by no test renders as unproven with no snippet, surfacing the gap
`check` would fail on rather than silently omitting a promise.

## 23. Absolute paths, and the answer naming files where they are

Found by running the tool, not by reading it: `render --out /an/absolute/dir` buried its pages
under `<repo>/an/absolute/dir` while the JSON named the absolute paths — the outcome claimed
files that were not where it said. The cause was one habit applied at the wrong boundary:
`path.join` concatenates, so joining a caller's directory onto the repo root silently rewrites
an absolute spelling into a relative one. Three sites did it — discovery's base directory, the
write-back's target, the render's output.

**The rule that fixed it.** Every place a caller-supplied path meets the repo root now anchors
with `resolve`, which honours an absolute spelling and treats a relative one exactly as before.
`join` remains for building names *within* a directory the caller named. One rule for all
anchoring, so the next command added does not re-import the bug.

**Reported paths do not change with the spelling.** Discovery still reports every file relative
to the repo root, now by `relative()` rather than by construction — the committed entries carry
those paths, and a file's recorded location must not depend on how the location was spelled on
the command line. `render` is the deliberate exception: its outcome keeps the caller's spelling
(absolute in, absolute out), because the answer's job is to name the pages where the caller
will look for them. The two conventions are documented on `Outcome` rather than unified,
because they serve different readers: the committed file needs stability, the render answer
needs honesty.

**Render now refuses what it cannot read.** The completion check on this fix surfaced a nearby
gap: `render` silently dropped scan errors where `write` refused them, contradicting the spec's
"inputs it cannot read are refused the way the check and the write refuse them". The pages
record what the tests prove, so a test the scan could not read is a tree the pages cannot vouch
for — `render` now refuses before writing, the same reason `write` refuses before acting.

## 24. The whole spec in one page

Splitting the site into a page per capability (§22) was right for browsing and wrong for
everything else. Two readers do not browse: a person who wants to read the whole promise in
one sitting, and a model handed the spec as context, which reads one file far better than it
follows nine links. Both were being asked to reassemble by hand what the render already had
in memory.

So `render` writes `build/spec.md` as well: every capability in name order, each requirement's
description, each scenario's Gherkin and live position, all in one file. The index links to it,
so the single entry point offers both ways in.

**It is not a reversal of §22.** The pages stay exactly as they were — the browse view is still
a page per capability, and the full page is an extra output, not a replacement. What §22
rejected was *only* having the scroll.

**One render, two shapes.** The full page is not a second renderer. Requirements and scenarios
go through the same functions the capability pages use, given a heading depth: `##` for a
requirement on a capability page, `###` in the full page, where the top level is spent on the
capability. Two views built from one code path cannot say different things — the same
shared-not-copied stance §22 took with `firstSiteByIdentity`.

**It carries the links, not the code.** A scenario in the full page links to the snippet that
proves it, exactly as on a capability page. Inlining every proof would have doubled the file
with the code pages' content and buried the promise it exists to show.

## 25. Which promises did this change touch

`check` asks whether the tests and the committed files agree. Reviewing a diff asks the
opposite question: *this* change — which promises did it put its hands on? Everything needed
to answer it was already here. A proof site carries its file and its line span, and a
scenario's identity is what the committed files record, so changed lines → sites → scenarios
→ requirements is a lookup, not an inference. All that was missing was reading the diff.

**A proof starts where its claim is written.** The first cut matched changed lines against
`[site.line, endLine]` — the test itself. On this repo's own branches that finds the same
scenarios nearly every time, because a rewritten claim usually comes with a rewritten test
under it: on the branch that added §24, all six touched scenarios were found either way. What
body-only matching cannot see is the change that touches *only* the claim. Rename a scenario,
or reword a THEN, and every changed line sits in the comment block above the test: measured
here, a one-word edit to a THEN on line 23 of a proof whose code opens on line 25 is reported
as "changed outside every proof" and names no promise at all. Passing most of the time on
luck is worse than failing, because the one case it misses is the promise being rewritten —
the edit a reviewer must not miss.

So the claim is part of the site. `test-scan` reports `tagLine`, the line the tag-and-Gherkin
block opens on, and the span runs from there to the test's last line.

**The claim and the proof are different news.** A change above the tagged line rewrote the
promise; one below it rewrote only the evidence. The report says which, because they ask the
reader different questions: "should this promise change?" against "does this still prove it?"

**Lines that prove nothing are still reported.** A helper, an import, a fixture — a real
change with no promise behind it. Dropping them would read as "this change touched nothing"
when it touched plenty.

**No seventh capability.** The git process is a boundary, and `cli` already owns the
boundaries (§20): `cli/diff.ts` runs git and turns a `--unified=0` diff into line ranges,
the way `cli/discover.ts` turns a directory into strings. Matching those ranges against
sites is the inverse of locating a scenario, so it lands in `locate` beside `locate` itself.
The count stays six.

**It measures from where the branch left `main`.** Work happens in a worktree per task
(`CLAUDE.md` Rule 5), so the useful default is "what did this branch touch", not "what is
uncommitted". It counts the working tree and files git has never seen, because in a worktree
most of the work is uncommitted most of the time — diffing `main...HEAD` on this very branch
reported nothing while every change sat in the working tree.

**A deleted proof is read from the base revision.** The current files cannot say what was
removed, so the old version of a changed file is fetched with `git show` and scanned. A
scenario that merely moved is still proven somewhere and is not reported gone; one that is
proven nowhere now is named, so a promise left with nothing behind it surfaces at review time
rather than at the next `check`.

**A repo can hand its tests over.** Discovery walks one `tests/` of `.test.ts`, and a repo
whose tests live elsewhere — several roots, component tests in `.test.tsx` under `src/` — is
not walkable by it. Its promises are not worth less for that. `RunOptions.tests` takes the
files the caller has already read and the roots they live under: the files stand in for
discovery, and the diff is scoped to the roots, because a test file the branch deleted is not
among the files and its removal is only visible when the diff is pointed at where tests live.
The first consumer reads its tests its own way (it excludes screenshot folders the walk would
read as files); the measuring stays one implementation. This is the same shape as §23's answer
to absolute paths: the caller names where things are, the tool keeps saying what they mean.

**It reports, it never judges.** Whatever it finds, it exits zero — including a promise
nothing proves any more. Turning a fact into a failed build is `check`'s job, and giving two
commands the power to fail CI for the same cause would make it ambiguous which one to fix.

**What it deliberately does not do.** It maps *tests* to promises, not source code to
promises. Which test covers `src/locate/render.ts` is not something this tool knows: it would
take per-test coverage or a call graph, both of them external, and the call graph is exactly
what goes stale in a worktree (the codebase-memory index tracks the main checkout only). If
that link is ever wanted, it should arrive as an input — a file-to-test map handed in — with
`touched` still doing only its own half: tests to promises.

## 26. From changed code to the promises it reaches

§25 answers "which promises did this change touch" by starting at a changed *test*. The
question a reviewer actually asks first is the other one: I edited this function — what
depends on it, and which tests get there? Those tests are what to review, and the promises
they prove are what to re-read.

That walk needs a call graph, which ProofSpec has no business building: parsing a whole
repository's call relationships is a different tool's job, and this one already has an index
of the repo sitting beside it. So `impact` reads the graph from codebase-memory's index — by
running its CLI, the same way `touched` runs git — or from a JSON file when one is named.
The file is not an escape hatch bolted on: a test cannot index a repository, so it is how
the capability is proven at all, and it doubles as the way to feed in a graph from anywhere
else.

**A seventh capability, on purpose.** §22 kept the count at six by putting the render in
`locate`, because §12 had already assigned "rendering the tree" there. Nothing owns "what does
a change reach": `test-scan` reads tests, `spec-file` reads files, `spec-tree` groups, `guard`
decides, `locate` answers where, `cli` runs. Walking a call graph is none of those, and it has
its own promises to keep — place a change on its functions, walk backwards without looping,
name the tests where they reach. It gets its own capability file. The rule was never "six
forever"; it was "do not invent a capability for something that already has an owner".

**The graph is handed in as values.** `impact` takes nodes and edges, not a connection. That
keeps it a pure walk — a fixture and a real index are the same input — and keeps every
process boundary in `cli`, where git already lives.

**What the graph could and could not say.** Two things were found by running it, not by
reading about it. First, a test file calls through its *module* node, not a function node:
querying only functions left every test off the tree, and the first run looked like a change
nothing tests. Second, the index's `is_test` marks a test file's module but not the functions
inside it, so a helper in a test file reads as source. Test-ness is therefore decided by the
tests directory — the same rule the rest of the tool uses — and a node says whether it is a
function or a whole file, because a file node spans every line in it and would swallow the
change that landed in one function.

**The precision ceiling is the test file.** A graph records one call edge per (test file →
function), so a file whose ten tests all call the same entry point is one edge. `impact` can
say which *file* reaches the change, never which scenario inside it. Every promise that file
proves is therefore listed: over-reporting is the honest failure here, since the alternative
is a reviewer trusting a list that quietly dropped the scenario that mattered. Narrowing it
would take per-test coverage — a different input, from a real test run, which would arrive
the same way the graph does rather than being computed here.

**It bounds the walk.** Callers are followed to a depth, four by default. Without a bound a
long chain reaches the whole program and the tree stops meaning anything; a function already
on the tree is reported as repeated rather than expanded twice, which is also what ends a
cycle.

**It reports, it never judges.** Exit zero whatever it finds, for the reason §25 gives.

## 27. Which scenarios actually ran the change

§26 ends at a ceiling: a call graph reaches a test file, never a scenario inside it. Lifting
it needs something a static reading cannot give — what a test *did*, not what it could do. So
`impact` takes a second, optional input: a recording of a real test run.

**The join key is the line, not the title.** A recording names a test; a spec names a
scenario; in ProofSpec's own style those two strings differ on purpose (`it('renders each
capability as its own page')` proves `Scenario: A capability is rendered as its own page`).
Matching them by text would be a guess. What both sides do agree on is *where* the test is:
vitest's `includeTaskLocation` gives each test the line it opens on, and that is exactly the
line a proof site carries. A record with no location is dropped rather than written, because a
record that matched the wrong proof would be worse than a missing one.

**Counters are cumulative, so a test owns only what moved.** Istanbul's counters hold every
hit since the file was instrumented: by the tenth test they carry what the first nine did too.
The functions a test ran are the ones whose counters went up between a snapshot before it and
one after. That difference is the whole mechanism, and it is the one part worth a test of its
own — `impact.functionsRun` — while the setup file around it stays glue.

**Function names, not line numbers, and that was found by measuring.** The obvious design was
to record the source *lines* a test executed and intersect them with the diff. It is wrong:
istanbul's `statementMap` holds positions in the *transformed* code, and the drift grows with
every comment stripped — `identityKey` reported as line 9 where the source has it at 10,
`spanOf` as 46 where it sits at 54. Recovering original lines means carrying source maps
through the collector. Recording which *functions* ran sidesteps all of it, and it is the
right granularity anyway: `impact` has already turned changed lines into changed functions via
the graph, so functions are what the two sides can be matched on. Inline callbacks come
through as `(anonymous_3)` and match nothing, which costs nothing — a change inside a callback
belongs to the named function around it, and that is the one the graph reports.

**Both views are kept, and they disagree usefully.** The tree still comes from the graph,
because only the graph can say *how* a test reaches the change. The list of promises comes
from the run when there is one. On the change that added this feature the graph reached 4 test
files and 16 scenarios; the recording narrowed that to 2 and 12. The two it dropped —
`tests/cli/format.test.ts` and `tests/cli/json.test.ts` — really can reach the changed
renderer through `renderText`, but they only ever render a `checked` outcome, so they never
run it. That gap is the point: the graph's list is a superset kept deliberately wide, and the
run's list is exact. The report says which of the two is on the page.

**A recording that cannot be read is a cannot-run.** Falling back to the wide list would hand
a reader the superset while they believe they are holding the exact answer, which is worse
than either alone.

**Two operational facts, both found by running it.** The indexer's `--mode fast` produced 4
call edges out of this repo's tests where a full index produced 170 — the first tree came out
with no tests on it at all, and nothing about the output said why. And the indexer excludes
any directory named `coverage`, which silently swallowed the collector's own source until it
was renamed to `src/test-run`. Both are now in `docs/coverage.md`, because a tool whose
answer quietly depends on how its input was built has to say so where its user is looking.


## 28. Spec drift at scale, and who repairs it

Everything up to here has been about building the tree and keeping it honest. This section
is about what happens once the tree is large — and about a scope boundary that took three
wrong turns to find.

**The problem is arithmetic.** One scenario per proof site means a suite of 1,900 tests
carries 1,900 scenarios. If every test edit obliges a person to re-read its scenario, then
even a 10% touch rate is 190 reviews per change set. Any policy that puts a human on the
default path does not survive contact with a real suite. The goal is not to make review
faster; it is to take the human off the default path entirely.

### The source of truth moves between phases

The two phases run in opposite directions, and conflating them is what makes the question
look unanswerable.

**Development** — the test does not exist yet, so it cannot be the authority:

```
intent → spec → test → production code
```

**Maintenance** — the test exists, executes, passes or fails, and constrains production
code. The Gherkin does not execute:

```
production code → impact → test → touch → spec
```

So in maintenance the **test is the executable source of truth, and the Gherkin is its
human-readable interpretation**. That is not a demotion of the Gherkin. Its value was never
enforcement; it is that a person can learn what the system does without reading the test
body. It is an interpretation layer, and the point of an interpretation layer is to be
cheap to regenerate.

This does not mean the development flow should be inverted into `test → summarise → spec`.
New behavior still starts with a human stating intent. Two phases, two directions.

### The repair loop

Because the Gherkin is a reading of the test, and because we trust an AI to read a test
honestly, the AI may rewrite it:

```
test changes
     ↓
AI reads the new test and states what it now proves
     ↓
compare against the Gherkin sitting above it
     ↓ agrees    → nothing happens
     ↓ differs   → the AI rewrites the Gherkin
```

The trust is load-bearing. It is what removes the human from the default path; without it
every step below collapses back into a review queue.

The check is entirely local to one proof site. `specs/` records only scenario titles and
locations — the Gherkin body lives in the test, above the `it(` — so the AI is handed a
bounded span and asked one question about it. This is the bijection paying off in a new
place: re-interpretation is tractable *because* a proof site is a bounded span rather than
a file.

### Three wrong turns, recorded so they are not re-walked

**(a) Gating on whether the Gherkin text changed.** `scenariosTouched` already reports
`claim: 'changed' | 'unchanged'` (`src/locate/touched.ts`), and it is tempting to read that
as a triage signal: the claim moved, so a human must look. Wrong direction. The source of
truth is the test, so the trigger is *the test changing*; the claim moving is an effect, not
a cause. A mechanical text-diff filter is cheap but the wrong shape.

**(b) Reserving Gherkin rewrites for a human, on the grounds that Gherkin is intent.** True
in development, false in maintenance. Once the test exists, the Gherkin is a reading of it,
not an authority over it. Forbidding the AI to rewrite it reinstates the 190 reviews.

**(c) Building an escalation ladder.** Having granted the AI the rewrite, the next instinct
is to ask when a human gets pulled back in, and to answer it with machinery: identity-versus-
wording rules, a requirement that a changed meaning must change the scenario title so the
guard trips, an exception taxonomy for split scenarios and collisions. All of it is
unnecessary, because of the boundary below.

### The boundary: ProofSpec reports, it does not orchestrate

Every rewritten Gherkin does get read by a person. But that reading happens in the commit
diff and the pull request — a channel that already exists and that ProofSpec did not build
and must not duplicate. ProofSpec has no business owning an approval gate, a review queue,
or a taxonomy of exceptions.

Its whole obligation is one signal:

> **this scenario's claim moved, and it moved because these tests moved.**

That causal half is what makes the review cheap. A reviewer who sees a Gherkin edit floating
in a diff has to reconstruct why it is there; a reviewer told which test change produced it
knows exactly what to check it against.

Half of this exists. `claim: 'changed' | 'unchanged'` is the reporting primitive — after two
attempts to promote it into a decision gate, it turns out to have been the right field all
along, doing the job it was named for. What is missing is the causality: `touch` currently
says which scenarios a set of changed lines reached, not that a claim moved *because* a test
moved.

### The graph is an index, not a second source of truth

A related conclusion, about lifetime. The dangerous design is a long-lived graph that every
change is folded into:

```
Index₀ → Diff₁ → Index₁ → Diff₂ → Index₂ → ...
```

Run long enough and the stored graph diverges from the code it describes. That is **graph
drift**, and it is worse than spec drift, because the tool reports it with the same
confidence as the truth.

The rule that prevents it: `graph = f(current repository)`. Deleting the graph and rebuilding
must produce the same graph. Incremental update from a git diff is then a performance
detail, not a source of truth — if the incremental path corrupts itself, the repair is
`delete cache; full rebuild`.

ProofSpec largely satisfies this already, by an accident of an earlier decision. `impact`
receives the call graph as plain values and never learns where they came from (see the
header of `src/impact/types.ts`), so there is no persistent graph here to drift. The thing
that *can* drift is `specs/` — the committed record of where scenarios are — which is
precisely why `spec:check` and `spec:write` exist. Rebuild-and-compare **is** this rule,
already implemented, for ProofSpec's own index.

### The index provider is replaceable; the semantic model is not

Where the call graph comes from should stay an implementation choice:

```
compiler / codebase-memory / other indexer
                 ↓
           adapter layer
                 ↓
      ProofSpec semantic model
                 ↓
          impact / touch
```

A language's own compiler gives the most precise answer within its language — for
TypeScript, exact symbols, references and call sites — but it stops at the language
boundary, and a real repository is rarely one language. A cross-language index earns its
place there. Depending on such an index directly is a reasonable engineering choice; there
is no value in reimplementing a worse one for the sake of independence. What must not happen
is ProofSpec's semantics being defined in terms of some index's internals.

**One constraint to verify before committing to any provider:** `impact` is line-precise —
`CallEdge` carries the line a call is written on, `GraphNode` carries `from`/`to`
(`src/impact/types.ts`). A symbol-level cross-language index may not supply call-site lines.
If it cannot, it supplements the compiler for other languages rather than replacing it.

### AI reads the graph through queries, not by swallowing it

A graph of any real size does not fit in a context window, and pasting it in would be the
wrong move even if it did. The right interface is a query surface —"which tests does this
change reach", "which scenario does this test prove", "trace source → test → scenario" —
which is close to a thin wrapper over the commands already in `src/cli/`. An agent does not
need to hold the graph; it needs to know which edge to follow next.

### Not built yet

Deliberately absent, per YAGNI: the interpret-and-compare step itself, the causal half of
`touch`'s output, any adapter to an external indexer, and any MCP surface. The first of
these is the one with the shortest path — its inputs already exist, in the span from
`scenariosTouched` and the Gherkin steps from `test-scan`.

## 29. Which half of a proof a change reached

§28 settled what `touched` owes its reader: *this scenario's claim moved, and it moved
because these tests moved*. This section is that obligation built, and a defect it uncovered.

**Two states were not enough.** `claim: 'changed' | 'unchanged'` said whether the Gherkin
moved. But the maintenance loop needs to tell apart a test that moved while its promise
stayed behind — the case an AI must re-read and possibly rewrite — from an author who moved
both together, where the only question left is whether the two still agree. Both spelled
`changed`. The field is now `changed: 'claim' | 'proof' | 'both'`, a union rather than two
booleans, because `both` is a situation and not the conjunction of two flags.

**Building it exposed a wrong answer underneath.** A site's lines were computed as one span,
`min(tagLine, line, ...steps) .. endLine`. For a site tagged inside a test body that is
wrong twice over, because such a site carries the GIVEN/WHEN written above the whole test:
the span therefore starts at the top of the test and **swallows every earlier sibling**. On
a two-block test, changing the first block's assertion reported the *second* block's *claim*
as rewritten — the wrong scenario and the wrong half. The `hit.from < site.line` test read
as "above my code, so it is my claim", which holds only when nothing else is up there.

Nothing caught it because every proof site in this repo's own suite tags a whole test, so
layout B had never reached `scenariosTouched`. A capability can be wrong for a whole layer
of its input and stay green, if the suite only ever exercises the other layer.

**The fix is ownership, not a wider span.** Four zones, and what a test shares is shared in
*both* directions:

| lines | whose | half |
|---|---|---|
| the GIVEN/WHEN above the `it(` | every block in the test | claim |
| the setup between the `it(` and the first block | every block in the test | proof |
| a block's own tag and THEN | that block alone | claim |
| a block's own statements | that block alone | proof |

The symmetry is the point and it is not an implementation convenience. A shared GIVEN is
part of every sentence written under it — rewrite it and every scenario below promises
something else, so every one of them is reported. A shared setup is part of how every one of
them is proven — rewrite it and the promises stand while the evidence moved, which is the
`proof` state for all of them, not the `claim` state the old code gave. A site tagging its
whole test has no prelude to share, so both shared zones fall away and it reduces to exactly
the old behavior; that is why the existing suite stayed green through the change.

**The scanner had to give up one more fact.** Only the scan knows where the enclosing test
opens, and without that line there is no boundary between the shared prelude and a block's
own claim. `ProofSite` gained `testLine`, equal to `line` for a site tagging its whole test —
which doubles as the discriminator for having no prelude at all, so no flag was needed.

**A site now reports its own opening line.** `from` was the span minimum, so every block in
a shared test pointed at the same shared GIVEN. It is now the site's own `tagLine`,
which sends a reader to the scenario named rather than to the prelude its siblings share.

**What is still not built:** the interpret-and-compare step itself — an AI reading a moved
proof and judging whether the claim above it is still an honest reading. `touched` now
reports the three states that step consumes, and stops there, which is the boundary §28 drew.

## 30. The report is read by an agent

§28 drew the boundary — `touched` reports, it does not orchestrate — and §29 built the three
states. This section is about who reads that report, and what changes once you take the
answer seriously.

**The reader is an agent, and an agent's costs are not a person's.** A person reading
`touched` in a terminal wants the shortest thing that points them at a file; they will open
it themselves, and one file is one keystroke. An agent pays differently: extra context is
cheap and extra round trips are not. Handing it thirty file positions and making it read
thirty files is the expensive shape, and it is exactly the shape a terminal report has.

So the report now carries what the reading is *for*. The judgement §28 asks for — *is this
Gherkin still an honest reading of this test?* — needs the Gherkin and the test in hand.
`test-scan` had already parsed both, and `touched` was already holding them, and the report
handed over neither. That was the whole defect: not a missing feature, a payload thrown away
one step before delivery.

**Two defaults, and deliberately no third thing.** `touched` answers as JSON without being
asked, and that JSON carries the claim and the proving source. No new command, no
`--with-source`, no `--agent` mode. A flag an agent must remember is a flag it will not use,
and a second command is a second thing to keep true.

**The requirement's prose, carried once.** The report handed over the claim and the proving
lines as values and the requirement as a `file:line` — an address, which is the shape this
section exists to argue against. The reason it survived a while is real and worth writing
down: the cost is not the same on both sides. Proving source is a read *per scenario*, so
thirty scenarios were thirty reads; a capability file is one read that serves every scenario
under it, and the tool had already done that read to find the heading line. So the address
was cheap to redeem — but "cheap" is not "free", and the thing being addressed is the
standard the claim is judged against. It is now carried, and `spec-file` already parsed it:
`RequirementSpec.description` existed, and `touched` was throwing it away one step before
delivery. The same defect §30 opens with, one field over.

**Grouped under the requirement, not pointing at it.** The first attempt carried the prose
once in a `requirements` list and left every scenario pointing at it — no duplication, but an
indirection. The question that killed it: if the parent is going to hold the prose, why is it
not holding the scenarios too? Grouping removes the pointer *and* a duplication the flat list
had carried all along — each scenario's own copy of `spec: {file, line}`, thirty-seven times
on this branch for five distinct positions. So the report is now the tree it always described:
requirement → its touched scenarios, its removed proofs. A scenario carries only what is its
own, and its capability, requirement and position are read from the entry above it.

**The flat file-ordered walk was the one real objection, and it belongs to the other form.**
The spec had required scenarios in file order, because that is how a person walks a diff and
because two runs of a branch have to be comparable. Grouping breaks that walk in the JSON —
and does not touch the terminal form, which flattens the groups back into one file-ordered
list on the way out. §30's whole argument is that these are two readers; this is the first
time the two forms differ in *shape* rather than in payload, and the reason is the same one.
Comparability survives in the JSON by ordering requirements the tree's way, capability then
requirement, and the scenarios inside each by file.

**The lines that prove nothing carry their source too.** `unmatched` — the helper, import and
fixture edits that fall outside every proof — was the last thing in the report given as an
address, and it is the one where the address is worst value: 35 of the 39 runs on this branch
are one or two lines long, so the read costs more than the lines. The wrinkle is that the file
is often *not* a test: the scan reads `*.test.ts` and nothing else, so `tests/cli/support.ts`
was never in hand and has to be read back. A changed file that cannot be read back is now a
cannot-run rather than a run of blank lines — blank is a claim about those lines, and a wrong
one. Only files with lines to cut are read, so a deleted file cannot refuse a run.

**And most of what it reported was blank lines.** Carrying the source made that visible
immediately: 29 of the 39 runs on this branch were a single empty line. Git hands one back with
every block inserted beside it, so a change that adds tests reports mostly blank lines — they
belong to no promise, say nothing to a reader, and outnumber the edits worth reading. A run
that is nothing but whitespace is now dropped from the report in both forms. That is a small
retreat from `locate`'s rule that lines outside every proof must be named rather than dropped,
taken deliberately at the `cli` boundary: the rule exists so a helper edit is never hidden, and
a blank line is not one. A change that adds only blank lines now answers "nothing touched",
which for a tool that reports on promises is the true answer.

**A position and its prose are one field.** `spec` is now `{file, line, description} |
undefined` rather than a location beside an optional paragraph. They are read from the same
heading in the same pass, and a requirement either is declared or is not — two optional fields
that are always both present or both absent is the shape the style rules exist to prevent.

**The answer was being cut at 64KB, and only the new flag made it show.** `main.ts` wrote the
answer and called `process.exit`. A write to a pipe is asynchronous, so the process ended
before it drained and the reader got exactly 65536 bytes — a truncated JSON document, which
parses as a syntax error rather than as a short answer. The bug was always there; a compact
report of a small branch just never reached the buffer. Indenting the answer and carrying the
requirement prose made it ordinary to pass it: this repo's own `touched` answer is 68130
bytes. The fix is `process.exitCode`, letting the process end on its own once nothing holds
the loop.

This is the first thing in `cli` that `main.ts` being untested actually cost. The file is
"the one piece of `cli` that does not need a test to be right" because every decision was
moved out of it — but this was not a decision, it was the process boundary itself, and a
function call cannot have this failure mode. So the suite gained its one end-to-end test:
spawn the real entry point, read its output through a real pipe, and parse it. It is pinned
the way §31 says to pin things — the mutation was run, `process.exit` put back, and the test
fails.

**A flag for the person, never for the agent.** `--pretty` lays the JSON out over indented
lines, and it is not a walk-back of the paragraph above. The rule there is that an agent must
not have to remember a flag to be answered well; this flag is for the person who runs
`touched` in a terminal and reads the answer with their eyes. Nothing about the content moves
with it — the same report, the same keys — and without it the output is byte for byte what it
was, so no script reading the answer today notices the flag exists. The layout is applied in
one place, so a second command cannot lay out differently from the first.

**The proving lines are a list, not a span.** A scenario proven inside a shared test is
proven by the setup that test shares *and* by its own statements, with its siblings' lines in
between belonging to them. Those are the proof zones §29 already computes, so the answer fell
out of work already done. A sibling's lines are deliberately excluded: handing them over
invites judging one claim against another's evidence, which is the same class of error §29
fixed in the ownership walk.

**The format default follows the kind of answer, not the tool.** A touched report defaults to
JSON; a verdict defaults to text. These are not one setting with an exception — they are two
readers. What a person reads in the log of a build that just failed is a verdict, and
`check`'s machine interface was always its exit code rather than its stdout, so nothing is
gained by making that JSON. `impact` stays text as a decision rather than an oversight: it is
a tree read top-down, and nobody has yet asked to consume it as data. The switch is
exhaustive over the outcome kinds so that a sixth kind cannot inherit a default nobody chose.

**Where the decision lives matters.** `main.ts` is deliberately untested — "the one piece of
`cli` that does not need a test to be right" — which means a default cannot live there. It
moved into `render.ts` alongside the renderers, and the old `renderByFormat` came with it, so
the untested surface got smaller rather than larger while gaining a decision worth pinning.

**What this says about MCP.** The obvious next move from here looks like a query interface,
and §13 argues for one. It is still not the move. Nothing an agent needed here was blocked by
the transport; it was blocked by the answer being an address instead of a value. A query
protocol built over an answer of the wrong shape would have frozen that shape in. When the
queries become genuinely selective — a graph too large to serialise, a question about one
scenario rather than all of them — the transport will start earning its keep, and by then
what to define will be visible rather than guessed at.

## 31. Two wrong answers, found by mutation rather than by reading

§29 and §30 built the three states and the payload. Neither was found to be wrong by review;
both were found to be wrong by deliberately breaking the code and seeing what the suite let
through. This section records the two answers that were wrong, and what the exercise taught
about reading a green suite.

**A block stopped one line short of its own test.** A site tagged inside a test body ended at
its last *statement*, while a site tagging a whole test ended at its closing line. So on a
test proving several scenarios, the `})` belonged to nobody: turning it into `}, 10_000)` —
adding a timeout — reported *nothing touched*.

The rule that settles it was already written down twice. `specs/test-scan.md` says a block
ends "at the next tagged statement, or **at the end of the test**", and it also says
"untagged statements belong to the block above them". The closing line sits below the last
tag, so it belongs to the block above it for the same reason every untagged statement before
it does.

**And the tool's own suite was carrying the drift it exists to catch.** The scenario "A block
ends at the statement before the next tagged one" says in its THEN that the second block
"runs on through the untagged statement below it *to the end of the test*", and then asserted
the last statement's line. The Gherkin was right and the assertion was wrong, and nothing
noticed, because the assertion is what runs. This is the argument for co-location stated in
the negative: putting the claim beside the proof does not make them agree, it makes the
disagreement *visible to a reader* — and here nobody had read it since it was written.

**A changed run of lines is not all one promise.** `touched` marked a whole `LineRange`
matched the moment any part of it overlapped a proof, so the rest of the run vanished from
the report. Git hands out contiguous runs, so a helper edited just above the test it serves
arrives in the same run as the proof below it — and `specs/locate.md` is explicit that those
lines must be named, not dropped. The answer is to subtract what proofs own from each run
rather than discard the run whole, which is why `unproven` exists and why `unmatched` can now
come back as more runs than it was given.

**On reading a mutation report.** Five decisions survived their mutants. Four were genuinely
unpinned. The fifth — the ordering of the report — was not: it is guaranteed twice, once
where the diff is read and once where the report is assembled, so removing either alone
changed nothing. *Survived* means "this line is redundant" just as often as it means "this
behavior is unguarded", and the two call for opposite responses. Removing both sorts made the
scenario fail, which is the check that tells them apart.

**The pin that mattered most** was not on either fix. A block's shared step lines had no test
at all, and `halvesOf` splits the shared claim from the block's own claim purely on those
lines — so an off-by-one there reports a rewritten shared GIVEN as a changed *proof* instead
of a changed *claim*. The exact opposite answer, silently, with everything green. A capability
can be wrong in the one direction that inverts its meaning and still pass, if the input shape
that reaches that code path is the one the suite never builds.

## 32. The report became a gate

§30 made the touched report an answer an agent could act on, and §28 drew the line that it
reports rather than orchestrates. Both hold. What neither anticipated is what happens when the
answer is taken seriously enough to be acted on *every* time: the reading becomes a loop, and
a report built to be read once is the wrong shape for a loop.

**The measurement that started it.** This repo's own touched report was 64,919 bytes: 21.6KB of
proving source, 17.2KB of claim, 11.0KB of requirement prose, 6.6KB of unmatched lines. §30
argued that was the right trade — "extra context is cheap and extra round trips are not" — and
it was, under its own premise, which is that the reader reads it once and is done.

**Reviewing is per scenario, so it is a loop.** Every scenario under every requirement a change
reached wants the same judgement made of it, one at a time. Under a loop the premise inverts:
the work list is read on every turn, so carrying the claims and the proving source there
charges the whole branch's context to answer "what is left". Split into a list and a fetch, the
same branch answers that in 2,078 bytes.

**The saving is not in the total, and saying otherwise would be a lie.** A reviewer who works
through everything reads all of it either way, and the fetches add round trips §30 was right to
count. What changes is that the reading is bounded by one requirement at a time rather than by
the branch, and that "what is left" gets cheaper as the work gets done. On the worst requirement
of this branch the bound is 24KB rather than 65KB; most are under 5KB.

**Nothing recorded the answer, so nothing could enforce it.** This is the defect §30 left
behind, and it is the same *kind* of defect: not a missing feature, a fact the tool held and
threw away. A report said which promises a change reached; nothing said which had been looked
at. A change reviewed carefully and one merely reported on read identically, so no hook could
tell them apart, and the review step was advisory in exactly the way an advisory step always is.

**Addressability solves both, because they are one problem.** The report was stateless *and*
unaddressable: there was no way to say "give me the seventeenth" and no way to say "I have
judged the seventeenth". Giving each promise a key answers both at once. §30 had already
written down the condition under which this would come due — "when the queries become genuinely
selective … a question about one scenario rather than all of them" — and this is it.

### The key is the content, so a stale review cannot exist

A judgement is filed under a digest of what it judged: the scenario's identity, the description
written under its requirement, its claim, and the source of the lines that prove it. Change any
of them and the scenario is not the key its review was filed under, so it comes back unjudged.

This is deliberately *not* an expiry rule. A rule that has to notice staleness fails silently
when it fails to notice, and failing silently here means a promise passing the gate unlooked-at
— the one outcome the whole apparatus exists to prevent. There is no such rule to get wrong.

The line a step or a proof sits on is not in the key: a blank line inserted above a test moved
nothing anyone judged. The requirement's description is, and that was a decision with a cost —
fixing a typo in a SHALL sentence re-opens every scenario under it. It was taken because the
description is the standard a claim is judged against, so a reworded SHALL is a different
question being asked, and answering the old one does not answer the new one.

A removed proof is keyed by its name alone. Nothing of it is left to weigh, so the only question
it raises — was this promise meant to die — is answered once and stays answered.

### The gate's strength is what a pass costs, not what a report of a problem costs

The reviewer and the party the gate blocks are the same agent. That is the whole difficulty, and
most of the design follows from taking it seriously.

The obvious move — block the branch when a reviewer reports drift — is exactly wrong. It makes
lying pay: the agent is stopped by its own finding and holds the key to unblock itself, so what
the gate then measures is its willingness to let itself through rather than what it found. A
reported gap or drift therefore settles its promise just as a pass does.

The strength comes from the other side. A pass has to cite the line that proves the claim, and
the citation is checked against the proof's own line ranges and rejected if blank. Reporting a
problem needs a sentence. So the cheapest answer available is an honest one, and there is no
answer that is both cheap and false.

**What the citation buys is less than it looks, and it is worth being exact.** It does not prove
the reviewer read anything: the proving source is handed to them, so any line of it is theirs to
quote. What it does is force a commitment to one claim-to-assertion correspondence — and the
commonest real drift, a claim promising something no line asserts, is precisely the one that
cannot be pointed at. It is a forcing function on the reasoning, not evidence of effort. The
cited line is carried into the ledger as written, because that is what lets a person reading a
pull request see at a glance whether a reviewer pointed at an assertion or at an import.

Whether a line *is* an assertion is not judged. That needs to know the language, and `test-scan`
is the only capability that does.

**Four other things carry weight, and only one of them is mechanical.** Every review names its
reviewer, because the first question a reader of the ledger has is whether the reviewer was the
author — the author being the worst possible reviewer of their own work, having already convinced
themselves. Whether they were the same party is not decided here: the tool does not know who
wrote the change, and spawning a reviewer that never watched it get written is the harness's job.
The requirement payload carries the *question* rather than leaving it to the caller, because a
reviewer asked "is this claim honest?" answers yes and one asked to find the overstatement goes
looking. And the ledger is committed, so a page of bare passes is visible to a human in a diff
in a way no mechanical rule could make it.

### A ledger of lines, not a database

The record is `.proofspec/reviews.jsonl`: one review to a line, appended, committed.

A store was considered and turned down. The data is a few dozen rows a branch and the only query
is "does a judgement stand for this key", which a `Map` answers. What a database would cost is
everything this project values about the rest of its storage: a text merge of an append-only
file of content-addressed lines *is* the right merge, because two branches that both reviewed
produce lines that either say the same thing or concern different keys. A correction is a later
line, which is why the last one stands. And the record is read by people in pull requests, which
a binary file is not.

A line it cannot read stops the read rather than being skipped. Skipping a damaged record is how
a promise gets through unjudged, and a half-resolved merge is exactly what that damage looks like.

### Why this is not a walk-back of §25, §28 or "the count stays six"

**§25 — "it reports, it never judges."** Intact. What §25 forbade was failing a build over
`gone`, which is judging the *code*. The gate judges whether anyone *looked*, which is a fact
about this branch's reviewing. And §25's real test was whether two commands exiting non-zero
would leave a reader unsure which to fix: the check sends them to the spec, this sends them to
the review. Different remedies, no ambiguity, so the same exit code carries no confusion.

The gate is on the work list alone. Fetching a requirement is how a reviewer collects the work,
and an agent reading every fetch as a failed tool would stop partway through the job the gate
exists to make it finish.

**§28 — "reports, does not orchestrate."** Intact. The ledger does not run a reviewer, decide
who reviews, or retry. It records a fact and answers a question about the facts recorded.

**§30 — "extra context is cheap."** Amended, on the condition §30 itself wrote down.

**§25 — "the count stays six."** Already spent, on `impact`. The test was never the number; it
is whether a genuinely new question has arrived. "Has this been judged" is not "where is it"
(`locate`), not "do these agree" (`guard`), and not "what does this file look like"
(`spec-file`). So `review` is the eighth, and it reads no files: `cli` owns the ledger on disk
the way it owns every other boundary.

### What one pass of the loop caught

Running the gate on the branch that built it,
with a fresh subagent per requirement, is the only evidence here that any of the above works.
Eleven findings came back, and their shape is worth recording because it is one shape: a THEN
promising that something was *refused*, or *named*, or *reported*, proven by an assertion that
only shows some failure occurred. Four of them were `expect(x.ok).toBe(false)` with the reason
never read, so the same test passes when the code refuses for an unrelated cause. One was
`stringContaining('2')` standing in for "it says which line". One was a substring that appears
in both output formats standing in for "this is the text form, not the JSON". One promised the
answer lists the verdicts and never checked that half of the message. One had a WHEN describing
an experiment the test could not run, comparing a value with itself. Two were claims of "as
written" against a renderer that trimmed, and of "named" against an assertion that counted.
The last was a scenario about ordering whose own explanatory comment was false.

Two reviewers independently hit the removed-proof bug — a pass was structurally unreachable
for a proof the change deleted, so any branch that deleted one could never clear the gate — and
both refused to record a `drift` to get past it, saying in as many words that they would not
file a problem they had not found. That is the asymmetry doing the job it was built for, and it
is also the argument for it: the failure mode of an unclearable gate is not a blocked branch, it
is a reviewer who starts writing whichever verdict goes through.

### What is deliberately not built

**Sampling.** A second reviewer re-judging a random share, with the disagreement rate recorded,
is the only thing that would answer "is this batch of reviews worth anything" — every mechanism
above raises the floor without measuring where the floor ended up. It is the obvious next move
and it is not built, because the first thing to learn is whether the loop gets used at all.

**Mutation.** §31 is this repo's own record of two wrong answers that review could not find and
breaking the code did. `--verdict proven` — mutated, and the test caught it — is the only
verdict that would mean what a pass is trying to mean. It is far too heavy to ask of every
touched scenario, and it is the right escalation for a contested one.

It stopped being theoretical while this section was being written. Building the gate meant
adding scenarios for SHALLs that had no test, and several of those tests passed the moment they
were written — which is the shape a coverage test takes when the behavior was already right, so
it looks like nothing to check. One of them was checking nothing. The claim was that
requirements come back in capability then requirement order; deleting the sort left the test
green, because the fixture's file names happened to agree with the answer and the diff is
separately sorted by path. §31 had already recorded that this exact guarantee is made twice and
that removing either alone changes nothing, and the fixture walked into it anyway. The repair
was to name the files so their order disagrees with the answer at every position, and the check
that the repair worked was the mutation, not the reading.

So: a test written after the code, and passing on the first run, is unverified until something
breaks the code and watches it go red. That is cheap enough to be a habit rather than an
escalation, and it is what `--verdict proven` would make recordable.

**The hook itself.** The command can be held to now; whether `.githooks/pre-push` holds it is a
separate decision. Pre-push rather than pre-commit, when it comes: a gate that blocks a WIP
commit gets `--no-verify` into muscle memory, and a bypassed gate measures nothing at all.

## 33. Whose order a capability file comes back in

The read sorted a file's requirements by title. It looked like the careful choice — the same
`compareStrings` the tree and the guard use, applied one layer earlier — and it was wrong,
because the render reads the same result. `render.ts` deliberately does not sort inside a
capability, and its comment said so ("the requirement and scenario order is spec-file's,
kept as given"); what it was given had already been re-ordered. Every rendered page shipped
the requirements alphabetically, and nothing said so.

**The cost is prose, which is why it went unnoticed.** A description is the human's half of
the file, and prose refers to its neighbours. In a repo using this tool five descriptions
said "the requirement below" or "the next requirement" about a requirement the page had
moved *above* the sentence naming it. Every scenario was recorded correctly, every position
was right, the check passed — and the document lied about its own shape.

**The two halves of a file have two different owners, so they have two different orders.**
The scenario entries are written by the tool, and they stay in title order: the writer sorts
them (`write.ts`), so reading them sorted is reading them as written, and the same tests give
the same file on any machine. The requirements are written by a person, in an order that is
part of what they wrote. The read gives each half back the way its owner left it.

**Determinism was never the reason to sort here.** That was the assumption worth checking,
and it did not survive: `diffTree` keys scenarios by identity and sorts the keys itself, the
guard reads committed requirements into `Set`s and `Map`s and sorts every finding through
`compareFindings`, and `updateScenarioBlocks` walks the file's own sections in file order.
Not one consumer compares requirements positionally. A guard that regenerates a tree in CI
still compares it against the committed one identically.

**What the sort had been quietly holding up was tested instead of assumed.** The guard's
report order rested on two things at once — `compareFindings`, and a read that happened to
hand requirements over sorted — and removing one left the other unwitnessed. So "two runs
over the same tests report the same findings" now also promises a fixed order whatever order
a capability file declares its requirements in, with a scenario that feeds the guard the same
capability written both ways round. It fails if `compareFindings` is ever weakened to sort by
kind alone; the scan-order scenario beside it does not.

**The scenario that pins it is at the CLI, not at the read.** A unit test on
`readCapabilityFile` states that the read keeps the order; only an end-to-end render says the
*page* does, which is the thing that was broken and the thing a reader sees. Both exist: the
read's scenario is where the rule lives, the render command's scenario is where its
consequence is visible.

## 34. The vocabulary

A capability file may define terms — `### Term: TURN` with a definition beneath, parallel
to `### Requirement:`. A term is defined once in a repo and means that one thing everywhere:
the vocabulary is global across files, because a word the spec leans on cannot mean one
thing in one file and another in the next.

**The hole this closes is a smuggling channel.** Before terms, a definition could be
rewritten and every requirement that leaned on it changed meaning with no line of any test
moving — the review key stayed put, the gate stayed shut, and the change passed unreviewed.
Folding the definitions a promise's standard uses into its key closes it: a redefined word
is a different question being asked of every promise that uses it, so the key moves and the
promise is judged again. The material is appended only when a term is used, so a repo with
no glossary digests byte-for-byte as before — proven by a golden key, not asserted, because
audan runs sibling code directly and must not see so much as a byte move.

**The convention is the matcher.** A use is a whole word in the exact form the term was
defined in — ALL CAPS, singular, verbatim. No case folding, no plurals, no stemming: a
stemmer is a guess about English, and the guard does not guess. Capitals are what make the
convention checkable by machine (rule 10); whether a requirement wrote the singular where
the plural was meant is a judgement, and it is left where judgements live — with the
reviewer reading the claim.

**One relation, walked in two directions.** Keying asks *what does this promise use*: it
walks from the terms the standard names *into* their definitions, transitively — a
definition that leans on another term leans on it in every promise that uses the first.
Re-opening asks *what does this change touch*: it walks from the changed term *out* to every
term whose definition leans on it. The first build got the keying walk backwards — it
followed a change's direction instead of a use's — and the completion pass caught it
end-to-end: a review was filed, the underlying term was redefined again, the key stood
still, and the gate opened for a meaning the promise was never judged under. Both walks now
share one function that says which texts are a promise's standard, because keying and
re-opening must read the same texts or they disagree about what a change meant.

**A re-opened promise carries its history.** The report says which terms re-opened it and
what each meant then and now, because the distance the meaning moved is the whole of what
the reviewer was asked about. When both axes reach a promise — a test line moved *and* a
definition moved — it is gathered once with both, not twice: one promise, one judgement.

**The vocabulary is rendered as one page**, linked from the index only when terms exist, so
a repo without a glossary renders exactly the pages it always did.

**The edges live only in the exact form.** A definition rewritten to say "the site that
proves" where it said PROOF SITE has cut an edge the machine still believes in: the word
moved, nothing re-opened, and the promises hanging off it keep a key for a meaning they no
longer have. Nothing mechanical catches a paraphrase — the guard's term rules check the
names, not the uses — so the backstop is the reviewer reading a changed definition's then
and now. A WARN for a definition spelling a defined term in a near form is deliberately not
built yet: this repo's own prose still writes claim, proof and promise in lowercase
throughout, so the rule would report nothing but the adoption it is waiting for. It is the
first worktree after that adoption lands.

## 35. The adoption

This worktree is the one §34 was waiting for: every lowercase concept reference in the
`specs/` prose and the tests' Gherkin blocks was changed to the exact capitalised form —
TERM, CLAIM, PROOF, PROOF SITE, KEY, LEDGER, PROMISE, STANDARD, CAPABILITY FILE — leaving
everyday English, the verbs (claims, promises, proves), fixture text, and code untouched.
README and `docs/` were left lowercase on purpose: they are prose about the tool, not
spec text the matcher reads.

**Plurals were the one editorial decision.** The vocabulary has no plural forms, so a
plural reference had to become either a legal-text plural over the singular ("both its
PROOF", "the other CAPABILITY FILE") or a rewording through every/each/a. The matcher
enforces the exact form on uses; the prose now obeys the same law it is judged by, which
is the point of the convention — a reader who sees PROMISE knows it is the defined word,
and a reader who sees "promise" knows it is not.

**The re-key was the test §34 could not give itself.** Changing the wording of every THEN,
scenario title, requirement heading and description moved every identity digest at once:
291 PROMISE came back pending — 183 live under new KEY, 108 gone as their old KEY died —
and the gate stayed shut until each was judged by a reviewer who had not written the tests.
Nothing passed unlooked-at, no review survived the wording it was filed under, and the
stale-review channel stayed closed the way §34 designed: not by detecting staleness, but
by the key simply no longer being the one asked for. The editorial pass was wording-only
and moved no code; the suite stayed green capability by capability throughout, which is
what let the judging be a re-reading rather than a repair. On merged main the gate measures
from the unpushed upstream, and 30 further PROMISE surfaced — re-opened by the term axis
itself, because the glossary landed between upstream and here and their standards now use
TERM that did not exist when they were last judged. That is the second axis working as
designed, from the outside, unbidden.

**Gone promises were judged drift, with the reason in the note.** A removed PROOF can be
passed with no citation, but a pass says "this PROMISE was meant to die", and a re-keyed
promise did not die — its identity moved. The ledger has no verdict for *superseded*, so
the 108 re-keyed entries carry drift and a note saying where the scenario went, which is
the fact a later reader of the diff needs; the note is doing work the verdict cannot.

**What this unlocks is §34's deferred WARN.** The rule that would flag a definition
spelling a defined TERM in a near form was deliberately not built while the prose itself
wrote the terms lowercase — it would have reported nothing but its own adoption. That
excuse is now gone: the spec text uses the terms or avoids them, so a near-form spelling
in a definition is a real paraphrase, and the rule is buildable next.

## 36. The underscore, the near form, and the description axis

Three changes in one dependency order — R3, R2, R1 — each re-keying this repo's own
promises, each judged in its own round. The order was the engineering: the rename in R3
re-keys nearly everything, so it went first and alone, one edit batch and one judging
round; had the rounds been interleaved, or the rename split per capability, every round
would have re-opened the whole vocabulary's users again, and the judging would have gone
quadratic in rounds for no information. R1 landed last for the same reason — built before
the rename, the description axis would have measured the rename's own reworded standards
and re-opened everything a second time.

**One TERM is one token.** `PROOF SITE` and `CAPABILITY FILE` became `PROOF_SITE` and
`CAPABILITY_FILE` across the specs and the tests' Gherkin and tags; the guard's capitals
rule tightened to `/^[A-Z]+(?:_[A-Z]+)*$/`, so a spaced phrase no longer passes — two
capitals standing beside each other are indistinguishable from ordinary emphasis, and
`proof site` is ordinary English. The matcher needed no rule of its own: `_` is a word
character to `wholeWord`, so an underscored phrase was already one whole word. README and
`docs/` stay lowercase-spaced on purpose, as in §35. The rename was measured before it
was made: 252 PROMISE — 208 re-opened under new KEY, 44 gone as their old KEY died —
judged ok or drift by `underscore-review`, each pass citing the line that asserts its
claim, each drift note naming the underscore spelling the promise now stands under.

**§34's deferred WARN is built.** A definition that spells another defined TERM in its
bare lowercase form — `claim` where CLAIM is defined — now warns (`term-near-form`)
without failing the build: the edges of the vocabulary live only in the exact form, so a
paraphrase cuts an edge the machine still believes in, and the warning is where that
becomes visible. Plurals are deliberately unmatched — `claims` may be a verb or an
ordinary plural, and stemming is a guess about English. This vocabulary self-checks
clean under the rule, which is what §35's adoption bought.

**The description is the third axis.** `touched` now compares each requirement's
description against the same base revision the tests are measured from, and a reworded
one re-opens every scenario under the requirement through the same gathering path as a
changed TERM — the same work list, the same gate. Keying had folded the description into
every key under it since the beginning; §34's argument for the term axis applies to the
standard word for word, and only the term layer had been built. A requirement new to the
working tree counts as changed (fresh keys, no judgements — entering the work list is the
honest state); one left byte for byte unchanged re-opens nothing however the file moved;
a promise a description change and a test change both reached is gathered once, carrying
both. The report says which half moved — `[a term it uses was redefined]`,
`[its requirement's description moved]` — and carries the wording then and now, because
the distance the standard moved is the whole of what the reviewer was asked.

## 37. The dispatch agent — async programming on top of the gates

On 2026-09-08 a coordination session in the Audan workspace hand-rolled a dispatcher: it mapped live pi processes to worktree sessions, read each session's transcript to judge where two tasks overlapped, typed instructions into the target sessions' ptys through the shared nvim's RPC socket (each message labelled "coordination directive, the user has ruled — not typed by the user"), watched the session files to confirm delivery through the steering queue, and left a bash watcher behind to send a go-order when a condition became true. It worked, and it exposed exactly what a product would need to stop doing: guessing overlap from transcripts, and trusting a message's own claim of authority.

**The thesis.** Background tasks are not new — every harness has them. What none of them have is the human's judgement points *inside the queue's state machine*: either a human watches the whole run (synchronous work wearing an async costume) or nothing holds the agent to a reviewable contract. ProofSpec's gates are that contract. So the product is not the scheduler; the scheduler is the mechanism that executes the contract, and the contract is the product.

**Three roles, decoupled by the gates.** The *investigation agent* owns everything up to and including the disposition review — the one synchronous moment, where the human judges every rewritten and new requirement's prose, and `review` records the judgements on the spot. The *work agent* owns everything after it: red tests, build, review reactions, merge — unattended. The *dispatch agent* owns the queue between them: ordering, dependency edges, conflict avoidance, dispatching, notification. Because the disposition review pre-judges everything the branch will touch, the merge door (§32) degenerates into a mechanical check — every touched promise already judged — so a task has exactly one sync point, with a single exception path: when a build's tests prove a *judged* standard itself wrong, the work agent asks, and the task parks.

**Scheduling reads artifacts, never transcripts.** Reading another agent's conversation to infer progress or overlap is probabilistic guessing — fine once for twenty minutes, wrong as a product. The hand-off carries a machine-readable `manifest` (intent ref, `specTouches` — which spec files and scenarios it rewrites, `fileTouches`, `deps`, conflict surface); the work agent maintains a checklist `PLAN` whose ticked state is parsed, not read; open questions land as structured `ASK`s. All agent-to-agent artifacts are English — the project is open source, and the agents converse in English. The division of §3 holds at the scheduling layer too: the LLM writes the prose, deterministic code tracks the state.

**The feedback loop.** Work agents rewrite specs, so the disk is always behind the queue. A census that reads only the on-disk specs judges against a base that is about to be stale — two boats rewriting the same requirement's prose is precisely the merge pain ordering exists to avoid. So the census input is *specs as of now, plus the `specTouches` of every in-flight task* — which makes the investigation agent, holding the freshest spec view, the right author of dependency edges: it declares `deps` when enqueueing, and the dispatcher turns them into hold-for relationships.

**Notifications may be relayed; verdicts may not.** A work agent blocked on a question writes an ASK and parks. The dispatcher emails the human — "task X is waiting on a ruling, answer in its session" — a pointer, never an answer. The ruling is typed by the human in the work agent's session and lives in that session's record with real provenance. "The user has ruled" must trace to a record — a disposition-table commit, `reviews.jsonl` — because a dispatcher that can generate authority is the single most dangerous component in this design. The hand-rolled session's self-labelled directive was true that once; a product cannot run on self-labelling.

**State lives in files; processes are stateless readers and writers of them.** This is how sessions themselves persist (JSONL on disk, resumable) and how the merge lock works (a `mkdir`, released by any crash). The queue follows: an append-only event log for audit, one directory per task holding the manifest, the checklist, a one-word `state` written atomically, and the open ASKs — `queued → building → mergeable → merged`, plus the parked states `held-for(X)` and `blocked-on-question` and the failure state `gate-failed`. A persistent agent is not a resident process; it is a state any session or CLI can pick up by opening the directory. v0 has no daemon — the scheduling loop wakes on events (enqueue, merge done, extension startup scan) and earns a timer only when that proves insufficient.

**The path.** v0: the queue directory, a small `dispatch` CLI (add, list, status, hold), hand-written manifests, RPC-spawned work agents, and one scenario proven end to end — task B runs half way, then waits for task A. v1: a pi extension, so the investigation agent hands off by tool call and the census reads the queue natively. v2, only if the deterministic rules run out: LLM-assisted reordering, a resident loop, the headless entry into ship. Open questions: email transport; how mid-build manifest drift is recorded (leaning: append an event); how much of ship's interactive entry has to change to run headless — its review gates are already fresh subagents, so the machinery is closer than the entry point is.

## 38. Every TERM has one home, and the guard says so

§35 moved the vocabulary into `specs/glossary.md` and rewrote this file's own prose to
say so — *"the vocabulary is written once, here."* Nothing enforced it. `readCapabilityFile`
reads a Term section out of whatever capability file it is handed, and the flattened list
`guard` receives forgot which file each term came from before the rule that mattered could
ever see it. The gap was not hypothetical: three capabilities — `review`, `spec-file`,
`test-scan` — still carried eight terms of their own, untouched since before §35, because
moving the ones §35 was written about was never the same act as forbidding the next one
from staying where it was written.

**The home is named, not inferred.** Every other capability's name comes from a filename
the consuming repo chooses; `glossary` is the first name the tool itself knows. The
alternative — fail when Term sections appear in more than one file, whichever file that
turns out to be — was considered and rejected: it protects the invariant "one home" without
saying which one, so a repo could still end up with its vocabulary sitting in `review.md`
by accident of which file got there first. Naming the home costs a repo adopting ProofSpec
exactly one thing — call the file `specs/glossary.md` — and buys a fixed place a reader
looks without having to ask.

**It fails, not warns.** This makes four term rules the guard fails on, the third and
fourth (defined-twice, outside-glossary) sharing one shape: `term-not-in-capitals` and
`term-promises` are wrong on their own text; `term-defined-twice` and
`term-outside-glossary` are only wrong in relation to where else a word's definition
stands — one to another definition, one to a place the tool has already named. Both said
so unambiguously enough that a warning would have been a fix deferred for no reason: move
the section.

**The fix ran on the change itself.** Landing this on the repo's actual branch turned up
the exact drift the rule exists to catch — the eight terms above, plus ten commits of
unrelated dispatch work that had drifted `main` ahead of `origin/main` and taken
`specs/glossary.md` along with it as a side effect of an unreviewed move. Rebasing this
branch back onto `origin/main` before shipping restored the scattered terms this rule was
written for, which is what let the acceptance script's second step — cut `LEDGER` out of
the glossary, watch the guard name it — prove something a clean repository never would
have exercised for real.
