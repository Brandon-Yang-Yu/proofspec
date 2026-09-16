# ProofSpec — design record

A record of the design discussion. Captures the reasoning, not just the
conclusions, so a later reader (or AI) can see *why* each choice was made.

**Pruned 2026-09-16.** Earlier drafts of this file kept every bug found by a
review gate and every one-off migration count, on the theory that the record
should never be edited, only appended to. That theory cost more than it paid
for once the tree passed fifty sections: most of what accumulated was already
provable by reading the code and tests, not reasoning a future reader needs
handed to them. This pass removed that narrative in favor of the decisions
and the *why* behind them, and kept the section numbers stable — several are
cited by section number from `specs/*.md`, `.pi/agents/*.md` and code
comments, and those citations still resolve to the same topic.

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
   - It replaces the earlier rule "a different layer is a different scenario":
     api / component / e2e differ because the *action* differs, not because a
     layer label differs.
   - It is why AND is banned. An AND under a THEN admits a second outcome — a
     second scenario by this rule. Removing it turns every "and…" into a question:
     *can one block of assertions prove this?* Yes → another sentence in the same
     THEN. No → it was a second scenario all along.
   - **The tree partitions outcomes, not actions.** A requirement groups by promise;
     a scenario is identified by observation. The two are different dimensions,
     which is why one action can legitimately appear under several requirements.

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
     its own assertion.

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
and reports the current line — an AST scan, not a grep (§14). Because line numbers
never enter the stored file, editing a test never produces a false "spec drifted" diff.

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

- that every row of a table reaches the same THEN;
- that scenarios sharing a test really share its GIVEN/WHEN, rather than having been
  folded together to save an expensive setup.

**Opt-in:** a capability is enforced (rules 2, 3) once a test first tags it — not merely
by having a `.md`. A spec is authored before its tests, so a file with no tags yet is
planned, not built, and must not fail the build; the first tag switches enforcement on.
Older suites are not forced to retag all at once, and a tag whose capability has no file
is left alone too (the mirror case).

**The term rules (9–11) sit outside opt-in, on purpose.** A glossary file may hold
nothing but terms — no requirements, so no tags, ever — and leaving its rules off until
a test arrives would mean the one file whose whole job is the vocabulary is the one file
never checked for it. Terms are global across files (§34), so their rules are global too.

## 8. Relationship to OpenSpec

**Decision: thin layer, not a fork.** Keep the published OpenSpec tooling for the
plan-time proposal flow (it is maintained, and we don't want to own it) — the
`/opsx:propose` → `/opsx:apply` → `/opsx:archive` slash commands OpenSpec installs into
the coding agent. The `openspec` CLI itself has no `propose` verb; it scaffolds,
validates, and archives. ProofSpec is a small tool around it, not a fork of it.

The reusable kernel of OpenSpec (parsers + validation + schemas) is a small fraction of
its own codebase; the rest is stores, shell completions, telemetry, legacy migration —
none of it needed. Its own parser discards scenario titles and line numbers (built for
validation, not for the title+location indexing ProofSpec needs), so ProofSpec does not
lift the file — it borrows two ideas: the nested-header section-tree walk, and the
code-fence mask, so a `####` inside a code block is not mistaken for a header.

`openspec validate` requires every requirement to have at least one scenario, which makes
a requirements-only `spec.md` impossible under that tool. So ProofSpec retires
`openspec/specs/` as the durable store: OpenSpec is used only to author change proposals,
and ProofSpec owns the archive→tree step instead.

## 9. Workflow

ProofSpec's lifecycle, mapped onto the OpenSpec verbs:

1. **Confirm the requirement** — establish the high-level promise (product-reviewed,
   pre-code). OpenSpec's `/opsx:propose` fits here.
2. **Refine into scenarios** — break the requirement into detailed conditions.
3. **Apply** — create the test for each scenario; the scenario's Gherkin is written
   above its `it`. The requirement's `.md` gets its scenario locations written back.

## 10. ProofSpec's own top-level requirement

Superseded by [`docs/spec.md`](spec.md), which carries the finalized requirements. Where
the two ever disagree, `spec.md` wins.

## 11. The bijection, checked against a real suite

The one-scenario-one-test rule was a bet, settled by auditing it against a real
pre-ProofSpec suite that already ran a cruder version of the same idea (a `// Spec:` tag
per test, checked in both directions except for the duplicate-proof rule). Reading every
case where one test proved two scenarios, or two tests proved one, split into two shapes
the original layer-based rule could not settle — and they pulled in opposite directions.

**Decision A — a table, not a split.** Inputs that differ only in data are one scenario
on one parameterised test; the table lives where it already lives, in the `it.each`
array. The distinction between two inputs can be real *in the test* (different code
paths, different bugs) without being real *in the spec* (a reader needs one sentence).
Constraint: every row reaches the same THEN — checked by judgement, not by the guard.

**Decision B — the THEN moves to its assertion.** When one action proves several
scenarios, the shared GIVEN/WHEN stays above the test and each scenario's THEN sits on
the assertion that checks it. The bijection survives because the unit was never really
"a test" — it is *a place that proves one scenario*, and a place can be a block of
assertions. Forcing a split here would mean re-running an expensive setup to assert half
of what it already demonstrated.

Known cost of B: assertions in one `it` share a fate — the first failure hides the rest,
so a broken scenario A masks scenario B's status. Mitigate by keeping the blocks
independent of one another and preferring soft assertions (`expect.soft`) where the
runner offers them.

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
  the write-back depend on it behaving identically.
- **Language knowledge is confined to `test-scan`.** Everything downstream consumes
  `ProofSite[]` and never learns that TypeScript exists. v1 supports TypeScript only; a
  second language is a second scanner behind the same contract.
- **Delivery is CLI-only in v1.** As built, `locate` ships as a library and the shipped
  `cli` commands are `check` / `write` / `render` — a `where`/`tree` command surface
  remains a later `cli` change.

Two things deliberately *outside* the capabilities: the judgement checks named at the
end of §7 (they belong to a person or an AI reading the co-located claim), and the
plan-time propose flow (that stays with OpenSpec's `/opsx` commands, per §8).

**A capability requirement states behavior, never implementation.** The test is whether
it can be falsified by observing what the tool produces. Implementation choices — the
parser of §14, the syntax of §13 — are recorded here in the design record, not as
requirements. A drafted requirement that names a library, a config file format, or a
performance target is nearly always an implementation detail wearing a SHALL.

**And it is written in plain English.** One claim per sentence; the claim before its
reason; a list written as a list; no clause stacked behind an em-dash or a semicolon.
Lead each requirement with one SHALL sentence carrying the promise, then plain sentences
for the detail.

## 13. Proof-site syntax

How a scenario tagged on a block of assertions is written. One rule:

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
  belong to the block they sit in.
- **Steps are bare keywords** — `// GIVEN`, `// WHEN`, `// THEN`. Not the `- **WHEN**`
  markdown of a `.md` file; that decoration is for the spec document, not for code.
- **Continuation** — a comment line that does not begin with a keyword continues the
  previous step, which is how a step runs to more than one sentence without needing AND.
- **`//` only.** No `/* */`. One shape keeps the parse surface minimal.
- **`// Capability:` is file-level**, one per file. Two capabilities in one file → split
  the file.
- **No `describe` inheritance in v1.** A `// Requirement:` may not be hoisted onto a
  `describe` as a default for the tests inside it.
- **`it.each` is one proof site**, whatever its row count.

## 14. Choosing the parser

**Decision: an AST scan, on `oxc-parser`. Parse only — no type checker, no `tsconfig`.**

A line scanner lost on four counts: cutting an `it` body into block proof sites (§13) is
free on an AST (the body's `statements` array plus each statement's leading comments) and
requires tracking brace/string/comment state by hand on raw text; performance is not a
trade-off (200 files / 112,200 lines parse and walk in under 100ms); and an AST gives a
precise error location ("the third statement of `it(...)`, line 30") where a line scanner
can only say "near line 30" — a message read every day, since ProofSpec runs on itself.

Between `typescript`'s own `createSourceFile` and `oxc-parser`, both parsed an
adversarial and an edge-case sample identically. Two findings decided it against
`typescript`: **`typescript@7` (the Go port) no longer exports `createSourceFile`** from
its main entry, so depending on it means pinning `5.9` forever; and the one real advantage
`typescript` had — comments pre-attached to nodes — came to eighteen lines to hand-roll
against `oxc-parser`'s flat comment array, and the hand-rolled version is *stricter*
(requires a comment directly above its node, no blank line between), which is exactly what
the syntax rules ask for.

Costs accepted: `oxc-parser` is pre-1.0 and ships a native binary per platform. Both are
hedged by `test-scan` exposing only `ProofSite[]` — a `typescript@5.9` implementation
already exists and produces identical output, so reverting is a one-file change.

## 15. Open questions

- **Do requirement descriptions need a revision id?** The guard compares titles and
  files, so editing a requirement's SHALL text while leaving scenario titles alone passes
  silently — mitigated in part by §36's description axis, which re-opens review on a
  changed SHALL, but no revision id exists in the stored format itself.
- **A capability index?** One file per capability is settled; whether a top-level file
  also lists the capabilities is still open.

## 16. The build pipeline

How a capability gets built, recorded as the `ship` skill so the steps never have to be
respelled: **plan** (plan mode — the behavior gate, where a human confirms the scenarios
are the intent) → **tests, red** → **build to green** → **guideline review** (a fresh
subagent audits the diff against `docs/typescript-style.md`; it reports, the builder
fixes) → **completion check** (a fresh subagent confirms the code satisfies every
requirement and each test really pins its claim) → **archive the plan** (the *why* into
this record) → **wait for the human to say commit**.

The load-bearing idea: a builder is a poor judge of their own fresh work, so review hands
off to a reader who never watched the code get written. Every capability in this codebase
was built this way, and the two review gates reliably catch a real class of defect a
builder's own read does not: overly weak tests (an assertion that checks a symptom rather
than the claim) and style/reuse drift against the rest of the codebase.

## 17. The stable tree

`spec-tree` turns `ProofSite[]` into the tree `capability → requirement → scenario title →
file` and compares two trees. It is pure data: no file I/O, no Markdown (that is
`spec-file`), no exit codes (that is `guard`). Two functions — `buildTree`, `diffTree`.

**Identity is `(capability, requirement, scenario title)`.** This is where §3.2 lands as a
machine key. Line numbers and Gherkin steps are excluded on purpose: a line shift or a
reworded step must not read as a change to the spec.

**A rename is not a kind of difference.** The title *is* the identity, so a changed title
is a different scenario, and no comparison of two trees can tell a rename from one
deletion plus one unrelated addition. Three kinds of difference — added, removed, moved —
and a rename reads as one removed and one added.

**A site with no capability is set aside, not dropped.** The scan reports such a site with
`capability: undefined` and leaves the verdict to `guard` (§7 rule 5); `buildTree` returns
it in `unplaced` rather than filtering it silently.

**A collision keeps the scenario once and names every site.** Deduplicating quietly would
hide a broken bijection. The surviving entry takes the first file by name, not the first
the scan happened to reach, so the tree stays reproducible even while broken.

**Sorting compares UTF-16 code units, not `localeCompare`.** A tree regenerated in CI has
to sort the way the committed one did, and a locale-sensitive comparison would make the
machine part of the answer.

## 18. The guard

`guard` turns the rules of §7 into a verdict: it takes the scan and the committed tree and
returns a `GuardReport` — a `status` of `pass` or `fail`, and a list of findings. One
function, `guard({ scans, committed })`.

**The verdict, not an exit code.** A number a process exits with is not a fact about a
spec tree. What this capability owns is the verdict an exit code is made from; `cli` turns
it into a number at the boundary where processes live.

**It reads no files.** The guard takes the committed capability files as a `SpecTree`
rather than as paths — the same pure-data-in-pure-data-out cut `spec-tree` takes — so
`spec-file` stays the one place that knows the Markdown format.

**One input carries both halves of a capability file.** What a file *declares* (for
coverage rules) and what it *records* (for the comparison) are both just a `SpecTree`,
since a requirement declared and not yet proven is simply a `RequirementNode` with no
scenarios.

**Opt-in has a narrower scope than "leave the capability alone".** The gate is cut three
ways: the *comparison* applies to every capability that has a file (a file with recorded
entries is built, not planned); the *requirement rules* wait for the first tag; and a
capability with no file at all is dropped from the regenerated tree before comparison, so
its scenarios do not all read as added. The bijection rule sits outside the gate entirely
— a scenario claimed twice is a fault in the tests, not a claim about a capability file.

**Every failure carries a line except the ones that cannot.** A requirement nothing proves
has no site by definition; a scenario the tests no longer prove has none either. Both are
left without a line honestly rather than forced to carry one that doesn't exist.

**Findings are sorted for determinism**, by an explicit rank over the finding-kind union,
so a report cannot silently reorder itself run to run.

**A repeated `### Requirement:` heading warns rather than fails.** The reader records the
same entries under both headings, the tree keys a scenario by its title so duplicates
collapse, and nothing downstream reads them wrong — so failing the build would punish a
state the tool already copes with. But which heading is meant to survive is prose the
author owns, so the guard reports it and leaves the fix to the reader.

## 19. The capability file

`spec-file` is the format: it reads a committed capability `.md` into its requirements and
what they record, and it writes the recorded entries back without touching anything else.
Two functions — `readCapabilityFile`, `updateScenarioBlocks`.

**Text in, text out. It opens nothing.** The filesystem belongs to `cli`; every test of
this capability is a string compared against a string.

**One format, defined once, facing both ways.** The reader and the writer are separate
jobs but not separate formats — what a heading is, where a block starts and ends, and what
an entry looks like are decided in one file both go through, so they cannot disagree about
the same bytes.

**A fence nobody closed is not a fence.** A heading or marker inside an *unclosed* code
fence would, under Markdown's own rule that an unclosed fence runs to the document's end,
leave the write-back appending a block below it on every run — a file that never comes to
rest. Only a fence that is closed again masks anything.

**A marker is a line that is nothing but the marker.** Matching one loosely would mean
writing an indented marker back unindented.

**Both functions are total.** No `Result`, no error list. A line inside a block that is
not an entry records no scenario; a block with a lost marker is written back closed. Every
one of these states ends in front of the guard, which is the one place that turns "the file
no longer records this scenario" into a build failure.

**Reading gives back the description, and sorts one half of the file.** Entries come back
in title order (the order `SpecTree` holds them in, and the order the writer produces).
Requirements come back in the file's own order — that half is the author's to order, and
§33 records the mistake of sorting it.

**The capability's name comes from the caller, not the file's title.** Making an H1
load-bearing would let a typo in a heading detach a whole capability from its tests.

## 20. The commands

`cli` is the two commands people and CI run — `check` and `write` — and the one capability
that owns the filesystem and the process. Everything else in ProofSpec takes a string and
returns a value; `cli` is where the strings come from and where a verdict finally becomes an
exit code.

**A verdict, not an exit code — again.** A command returns an `Outcome` — `checked` with a
report, `wrote` with the files it changed, or `cannot-run` with a reason — and a renderer
turns it into the number a process exits with.

**`cannot-run` is a case, not a missing report.** CI needs to tell "your spec has drifted"
from "I could not read my inputs" — different non-zero codes (drift is 1, cannot-run is 2)
— and modelling the second as its own `Outcome` case is what makes the distinction
impossible to lose: a caller reads which happened from the tag, not by inferring it from a
number.

**Two commands, two functions.** `check` reads and reports; `write` records. Neither does
both, so a check has no path that could ever write: `writeFile` is imported once and
reachable only from the commands that record, never from `check`.

**It re-implements nothing.** `cli` is wiring — `scanSource`, `readCapabilityFile`,
`buildTree`, `guard`, `updateScenarioBlocks` — with the format knowledge in `spec-file`,
the language knowledge in `test-scan`, the rules in `guard`.

**Directories, walked, not globbed**, and sorted by name, because a scan that walked its
files in a different order on another machine could render the same tree differently.

**Flags, no config file.** The conventional layout (`specs/`, `tests/`) needs no
configuration; flags override it when needed. There is no compiler to point at and no
project to describe, so a config file would be machinery nothing asks for.

**JSON is the same answer, not a second one.** `check --json` prints the report; the human
form is a rendering of the same `Outcome`, never different content.

**`write` refuses when the scan reports any error.** `write` mutates the repo, and the
guard that would otherwise catch a partial write runs *after* the mutation has already
landed — too late. So a mutating command earns the invariant a reader would assume it
already had: it only changes files in a repo it could fully read.

## 21. Locating a scenario

`locate` is the **delivery** half of the split §4 makes: it reads the current `file:line`
from the proof sites as they stand and delivers the whole tree with those positions
attached, computed fresh on every call — never regenerated into a stored file, never
stale.

**Two answers, both values.** `locate(sites, identity)` returns `found` with a `file:line`
or `missing` naming the identity it looked for — a discriminated union, not a nullable
position, so a caller has to branch and a scenario that is not there can never be reported
as a nearby one. `locateTree(tree, sites)` walks `spec-tree`'s stable tree and adds only
the live line to each scenario, so the grouping and ordering rule stays in `spec-tree` and
is not built a second time.

**A library, not the commands — yet.** `locate.md`'s requirements are pure data behaviour
with no command, config, or exit code in them, so `locate` lands as the library this ship;
wiring a `where`/`tree` command surface through `cli` remains a later change.

**One comparator for a collided scenario's resolved file/line**, shared with `spec-tree`
and `guard` (`comparePlacements`), rather than a third private copy of the same tie-break
rule.

## 22. Rendering the readable site

The committed files are not meant to be read straight — §4 stores a scenario's title and
file and nothing else, so a person opening `specs/guard.md` sees *which* scenarios exist,
never *what they say*. `render` is the readable view: it writes a `build/` — an index, one
page per capability, and one code page per test, every requirement's description, every
scenario's Gherkin, and every proof's code and current position, pulled live from the
tests. `build/` is gitignored and always rewritten — a generated output, never a source the
tool reads back.

**One page per capability, not one document, plus one whole-spec page (§24).** A capability
is the unit a reader browses; a person reading start to end, or a model handed the spec as
context, reads one file far better than nine links. Both views are built from one code
path, so they cannot say different things.

**The proof travels with the claim.** Each test is a code page, and each proof a snippet of
exactly its lines, headed by its scenario, carrying that scenario's Gherkin, then the code
— claim above proof.

**The anchor reads as the scenario.** A snippet's heading is its scenario title, slugged
the same way the site's own renderer slugs headings, so the fragment a scenario links to
and the id its heading gets are the same string.

**It does not violate principle 1, because it stores nothing.** The Gherkin and the code
are delivered — read from the tests each run, written to an output a person reads — never
back into the committed files.

**It bypasses the stable tree.** `spec-tree` strips the steps by design, so `render` joins
the committed descriptions (from `spec-file`) to the raw scan sites (from `test-scan`,
which alone keep the steps and the line span), keyed by identity.

**No seventh capability.** The richer render lands in `locate` with the command in `cli`;
the count stays six.

## 23. Path handling

Every place a caller-supplied path meets the repo root anchors with `resolve`, which
honours an absolute spelling and treats a relative one exactly as before; `join` is only
for building names *within* a directory the caller named. Reported paths (discovery,
write-back) are always relative to the repo root, independent of how the caller spelled
the directory on the command line — `render` is the deliberate exception, since its answer's
job is to name the pages where the caller will actually look for them, so it keeps the
caller's own spelling. `render` also refuses rather than writing a partial site when a test
it must read cannot be read, the same reasoning `write` already applies to itself (§20).

## 24. The whole spec in one page

`render` writes `build/spec.md` alongside the per-capability pages: every capability in
name order, each requirement's description, each scenario's Gherkin and live position, all
in one file — for the reader who wants the whole promise in one sitting, or a model handed
the spec as context, rather than nine links to follow by hand. Not a second renderer:
requirements and scenarios go through the same functions the capability pages use, given a
heading depth, and it links to each scenario's proof rather than inlining it.

## 25. Which promises a change touched

`check` asks whether the tests and the committed files agree. Reviewing a diff asks the
opposite question: which promises did *this* change put its hands on? A proof site carries
its file and line span, and a scenario's identity is what the committed files record, so
changed lines → sites → scenarios → requirements is a lookup, not an inference — once the
diff is read.

**A proof starts where its claim is written, not where its code does.** Matching only
against a test's own body finds the same scenarios as matching the whole tagged block
nearly all the time, but misses exactly the case that matters: renaming a scenario or
rewording a THEN touches only the comment lines above the test, which a body-only match
reports as "changed outside every proof," naming no promise at all. So `test-scan` reports
`tagLine`, and the span runs from there.

**The claim and the proof are different news.** A change above the tagged line rewrote the
promise; one below it rewrote only the evidence — reported as different states (developed
further in §29).

**Lines that prove nothing are still reported**, because dropping them would read as "this
change touched nothing" when it touched a helper, an import, a fixture.

**It measures from where the branch left `main`, including the uncommitted working tree** —
the useful default for a worktree-per-task workflow, where most of the work is uncommitted
most of the time.

**A deleted proof is read from the base revision** (`git show`), so a scenario proven
nowhere now is named at review time rather than only at the next `check`.

**It reports, it never judges.** Whatever it finds, it exits zero — including a promise
nothing proves any more. Turning a fact into a failed build is `check`'s job alone.

**What it deliberately does not do:** map source code to promises. That is `impact` (§26),
a different capability, built on a different input (a call graph) for a different question
(what does a change *reach*, not which test changed).

## 26. From changed code to the promises it reaches

§25 starts at a changed *test*. The question a reviewer asks first is the other one: I
edited this function — what depends on it, and which tests get there? `impact` answers it
by reading a call graph from codebase-memory's index (or a JSON file, which is also how the
capability is proven at all, since a test cannot index a repository) and walking callers
back from the changed function to the test files that reach it, bounded to a default depth
of four so a long chain does not swallow the whole program.

**A seventh capability, on purpose.** Nothing in the existing six owns "what does a change
reach" — the rule was never "six forever," it was "do not invent a capability for something
that already has an owner."

**The graph is handed in as values**, never a live connection, keeping `impact` a pure walk
and every process boundary in `cli`.

**Test-ness is decided by the tests directory**, the same rule the rest of the tool uses,
because the index marks a whole test *file* as a test without marking the functions inside
it — a helper defined in a test file would otherwise read as source.

**The precision ceiling is the test file.** A graph records one call edge per (test file →
function), so `impact` can say which file reaches a change, never which scenario inside it
— every promise that file proves is listed, and over-reporting is the honest failure here.
§27 narrows it with a real test run.

**It reports, it never judges**, for the same reason §25 does.

## 27. Which scenarios actually ran the change

§26 ends at a ceiling a static graph cannot lift: it reaches a test file, never a scenario.
`impact` takes a second, optional input — a recording of a real test run — to narrow the
graph's superset down to the scenarios that actually executed the change.

**The join key is the line, not the title.** A recording names a test by its source
location (vitest's `includeTaskLocation`); a proof site carries the same line. Matching by
text would be a guess, since a test's own title and its scenario's title differ on purpose.

**Counters are cumulative; a test owns only what moved between a snapshot before it and one
after.** Istanbul's counters hold every hit since the file was instrumented, so the
functions a test *ran* are found by differencing two snapshots, not by reading counts.

**Function names, not source lines.** Recording executed *lines* and intersecting them with
the diff looked simpler and is wrong: coverage line numbers are positions in the
transformed code, which drift from the source with every comment the transform strips.
Functions are the granularity `impact`'s graph already works in, so both sides match on
them with no source-map recovery needed.

**Both views are kept, and they disagree usefully.** The graph's list is a superset kept
deliberately wide (it says *how* a test could reach a change); the run's list is exact (it
says which scenarios actually did). The report names which is which.

**A recording that cannot be read is a `cannot-run`**, never a silent fallback to the wide
list — handing a reader the superset while they believe it is the exact answer would be
worse than either alone.

## 28. Spec drift at scale, and who repairs it

**The problem is arithmetic.** One scenario per proof site means a suite of thousands of
tests carries thousands of scenarios; any policy that puts a human on the default path for
re-reading a moved scenario does not survive contact with a real suite. The goal is not to
make review faster — it is to take the human off the default path entirely.

**The source of truth moves between phases, and conflating them makes the question look
unanswerable.** In development the test does not exist yet, so intent → spec → test is the
only order that makes sense. In maintenance the test already executes and constrains
production code, so **the test is the executable source of truth, and the Gherkin is its
human-readable interpretation** — not a demotion; the Gherkin's value was never enforcement,
it is that a person can learn what the system does without reading the test body. An
interpretation layer's whole point is to be cheap to regenerate.

**The repair loop, once that is accepted:** a test changes; an AI reads the new test and
states what it now proves; if that differs from the Gherkin sitting above it, the AI
rewrites the Gherkin. The trust that an AI reads a test honestly is load-bearing — without
it, every step collapses back into a review queue — and the check is tractable precisely
*because* a proof site is a bounded span, not a whole file.

**Three wrong turns, recorded so they are not re-walked:**

- **(a) Gating on whether the Gherkin text changed.** Wrong direction — the source of truth
  is the test, so the trigger is the test changing; the claim moving is an effect.
- **(b) Reserving Gherkin rewrites for a human, because Gherkin is intent.** True in
  development, false in maintenance, and reinstates the review-queue arithmetic above.
- **(c) Building an escalation ladder** (identity-versus-wording rules, a required title
  change on any meaning shift, an exception taxonomy). Unnecessary, because of the boundary
  below.

**The boundary: ProofSpec reports, it does not orchestrate.** Every rewritten Gherkin does
get read by a person — in the commit diff and the pull request, a channel that already
exists. ProofSpec's whole obligation is one signal: *this scenario's claim moved, and it
moved because these tests moved* — the causal half is what makes that review cheap, since a
reviewer told which test change produced an edit knows exactly what to check it against.

**The graph is an index, not a second source of truth.** The dangerous design is a
long-lived graph every change is folded into, which drifts from the code it describes —
worse than spec drift, because it is reported with the same confidence as the truth. The
rule: `graph = f(current repository)`; delete-and-rebuild must reproduce it, so an
incremental update is a performance detail, never a source of truth of its own. `impact`
already satisfies this by taking its graph as plain values with no memory of where they
came from; `specs/` is the one thing here that can drift, which is exactly what `check`
exists to catch.

**The index provider is replaceable; the semantic model is not.** Depending on an external
indexer directly is a reasonable choice — there is no value in reimplementing a worse one
for the sake of independence — but ProofSpec's semantics must never be defined in terms of
that index's internals. One constraint to verify before adopting any provider: `impact` is
line-precise, so a symbol-level index that cannot supply call-site lines can only
supplement a language's own compiler, not replace it.

## 29. Which half of a proof a change reached

Two states were not enough. `changed: 'unchanged' | 'claim' | 'proof' | 'both'` tells apart
a test that moved while its promise stayed behind (needs re-reading) from an author who
moved both together (only needs agreement checked) — a union rather than two booleans,
because `both` is a situation, not a conjunction.

**Ownership is by zone, and a shared zone is shared in both directions:**

| lines | whose | half |
|---|---|---|
| the GIVEN/WHEN above the `it(` | every block in the test | claim |
| the setup between the `it(` and the first block | every block in the test | proof |
| a block's own tag and THEN | that block alone | claim |
| a block's own statements | that block alone | proof |

A shared GIVEN is part of every sentence written under it — rewrite it and every scenario
below promises something different, so every one is reported. A shared setup is part of how
every one of them is proven — rewrite it and the promises stand while the evidence moved,
`proof` for all of them. A site tagging its whole test (layout A) has no prelude to share,
so both shared zones fall away and this reduces to the simple two-state case.

`ProofSite` carries `testLine` (the enclosing test's own opening line) so a block's claim
can be told apart from its shared prelude, and each site reports its own `tagLine` rather
than the span minimum, so a reader lands on the scenario named, not a shared prelude its
siblings also own.

## 30. The report is read by an agent

The reader of `touched`'s report is an agent, and an agent's costs are not a person's: extra
context is cheap, extra round trips are not. So the report carries what the reading is
*for* — the claim and the proving source, not just a `file:line` address a reader would
have to fetch separately — because the judgement §28 asks for (*is this Gherkin still an
honest reading of this test?*) needs both in hand.

**Two defaults, deliberately no third thing.** `touched` answers as JSON without being
asked; no `--with-source` flag, no `--agent` mode — a flag an agent must remember is a flag
it will not use.

**The requirement's own prose is carried too**, and **grouped under the requirement rather
than pointed at from each scenario** — the report is the tree it always described:
requirement → its touched scenarios, its removed proofs, each scenario carrying only what
is its own.

**Lines that prove nothing carry their source too, minus pure whitespace.** A changed file
git cannot read back is a `cannot-run` rather than a run of blank lines, since blank is
itself a claim about those lines and can be a wrong one; a run that is nothing but
whitespace is dropped from the report in both forms, since it says nothing to a reader.

**The proving lines are a list of zones (§29), not one span**, and a sibling's lines inside
a shared test are deliberately excluded — handing them over would invite judging one claim
against another's evidence.

**The format default follows the kind of answer, not the tool.** A `touched` report
defaults to JSON (an agent's input); a verdict defaults to text (a person's build log);
`impact` stays text, since nobody has yet asked to consume it as data.

**What this says about MCP: not yet.** Nothing here was blocked by the transport; it was
blocked by the answer being an address instead of a value. A query protocol over an answer
of the wrong shape would freeze that shape in — worth building once queries become
genuinely selective (a graph too large to serialise, a question about one scenario rather
than all of them), not before.

## 31. What review could not find, mutation did

Several of the load-bearing decisions in §29 and §30 were verified wrong, then fixed, by
deliberately breaking the code and watching whether the test suite noticed — not by review.
The sharpest of them: a block's shared step lines had no test of their own, and an
off-by-one in the function that splits a shared claim from a block's own claim reported a
rewritten shared GIVEN as a changed *proof* instead of a changed *claim* — the exact
opposite answer, silently, with everything green. The generalizable lesson: a capability
can be wrong in exactly the one direction that inverts its meaning and still pass, if the
input shape that would exercise that code path is one the suite never happens to build.
Any boundary-drawing logic here is worth a mutation pass, not just a reading, before it is
trusted.

## 32. The report became a gate

§30 made `touched` an answer an agent could act on; §28 drew the line that it reports
rather than orchestrates. Both hold — but reading the answer becomes a *loop* once every
touched scenario is meant to be reviewed every time, and a report built to be read once is
the wrong shape for a loop: on a real branch the full payload ran to tens of kilobytes,
because §30's premise (read once, extra context is cheap) inverts under a loop, where the
same payload is paid for again on every turn just to answer "what is left."

**Addressability solves the size problem and a second, sharper one at once: nothing
recorded whether a promise had actually been looked at.** A report that said which promises
a change reached could not tell a change reviewed carefully from one merely reported on
apart — the review step was advisory in exactly the way an advisory step always is. Giving
each promise a key, fetched one at a time, answers both: "give me the next one" and "I have
judged this one."

**The key is the content, so a stale review cannot exist.** A judgement is filed under a
digest of what it judged — the scenario's identity, its requirement's description, its
claim, and the source of the lines that prove it. Change any of them and the scenario is
not the key its review was filed under, so it comes back unjudged. This is deliberately
*not* an expiry rule: a staleness check fails silently when it fails to notice, which is the
one outcome the whole apparatus exists to prevent.

**The gate's strength is what a pass costs, not what a report of a problem costs — because
the reviewer and the party the gate blocks are the same agent.** Blocking the branch on a
*reported* drift is exactly wrong: it makes lying pay, since the agent holds the key to
unblock itself. So a pass has to cite the line that proves the claim, checked against the
proof's own line ranges and rejected if blank, while reporting a problem needs only a
sentence — making the cheapest available answer an honest one. The citation does not prove
the reviewer read anything (the source is handed to them, so any line of it is theirs to
quote); what it forces is a commitment to one claim-to-assertion correspondence, which is
exactly where the commonest real drift — a claim promising something no line asserts —
cannot be pointed at.

**A ledger of lines, not a database.** `.proofspec/reviews.jsonl`: one review per line,
appended, committed. A few dozen rows per branch and one query ("does a judgement stand for
this key") does not earn a store, and a text merge of an append-only, content-addressed file
already resolves the way it should — two branches that both reviewed produce lines that
either agree or concern different keys, and a correction is simply a later line, so the last
one standing wins. A line that cannot be read stops the read rather than being skipped,
since skipping a damaged record is how a promise gets through unjudged.

**Not a walk-back of earlier boundaries.** §25's "it reports, it never judges" still holds
for the *code* — the gate judges whether anyone looked, a fact about the branch's reviewing,
not the code itself. §28's "reports, does not orchestrate" still holds — the ledger runs no
reviewer and retries nothing. §30's "extra context is cheap" is amended on the condition §30
itself named: true for a single read, false for a loop.

**Deliberately not built:** sampling (a second reviewer re-judging a random share, to
measure whether the loop is trustworthy at all — the natural next step, held until the loop
is known to be used); mutation on every touched scenario (too heavy as a default, the right
escalation for a contested one); and wiring the gate into a git hook (a decision separate
from having the command exist — a pre-push hook, if ever, never pre-commit, since a gate
that blocks a WIP commit gets `--no-verify` into muscle memory and then measures nothing).

## 33. A capability file's two halves have two different owners, so two different orders

Its scenario entries are tool-written and stay in title order, the order the writer
produces on every machine; its requirements are person-written and stay in the file's own
order, since a description refers to its neighbours ("the requirement below") and that
prose is part of what the author wrote. Nothing downstream may re-sort either half — every
real consumer (`spec-tree`'s diff, `guard`'s findings, the write-back) already keys or sorts
what it needs itself, so sorting a read the read was never asked to sort only breaks the
render's promise to show a file the way its author left it.

## 34. The vocabulary

A capability file may define terms — `### Term: TURN` with a definition beneath, parallel
to `### Requirement:`. A term is defined once in a repo and means that one thing
everywhere: the vocabulary is global across files, because a word the spec leans on cannot
mean one thing in one file and another in the next. Every TERM's home is named, not
inferred — `specs/glossary.md` — enforced by two guard rules that fail rather than warn
(`term-defined-twice`, `term-outside-glossary`), since both are unambiguous the moment a
second definition or a second home exists.

**The hole this closes is a smuggling channel.** Before terms, a definition could be
rewritten and every requirement leaning on it changed meaning with no line of any test
moving — the review key (§32) stayed put, and the change passed unreviewed. Folding the
definitions a promise's standard uses into its key closes it: a redefined word is a
different question being asked of every promise that uses it, so the key moves.

**The convention is the matcher.** A use is a whole word in the exact form the term was
defined in — ALL_CAPS, singular, verbatim, one token (`_`-joined, not space-joined, so the
guard's capitals rule can tell a defined term from ordinary emphasis). No case folding, no
plurals, no stemming — a stemmer is a guess about English, and the guard does not guess.

**One relation, walked in two directions, through one shared function.** Keying asks *what
does this promise use* — walking from a standard's terms into their own definitions,
transitively. Re-opening asks *what does this change touch* — walking from a changed term
out to every term whose definition leans on it. Both walks read the same texts, or they
disagree about what a change meant.

**A re-opened promise carries its history**: which terms re-opened it, and what each meant
then and now — the distance a meaning moved is the whole of what a reviewer is being asked
about.

## 35. The adoption

Every lowercase reference to a defined concept in `specs/` prose and the tests' Gherkin was
changed to the exact capitalised, underscored form (TERM, CLAIM, PROOF_SITE, KEY, LEDGER,
PROMISE, STANDARD, CAPABILITY_FILE), leaving ordinary English, verbs, fixture text, and code
untouched; `README`/`docs/` stayed lowercase on purpose, since they are prose about the tool,
not spec text the matcher reads. The re-key this produced was itself the test §34 could not
give itself: changing the wording of every affected THEN and heading moved every identity
digest at once, and the review gate (§32) had to re-judge each one fresh rather than
inherit an old pass — nothing passed unlooked-at on the reword alone.

## 36. The underscore, the near form, and the description axis

**One TERM is one token.** A defined term is written `_`-joined (`PROOF_SITE`, not
`PROOF SITE`), because two capitalised words standing beside each other are
indistinguishable from ordinary emphasis, while an underscored phrase is already one whole
word to the matcher with no special-casing needed.

**The deferred WARN from §34 is built.** A definition that spells another defined term in
its bare lowercase form — `claim` where CLAIM is defined — now warns (`term-near-form`)
without failing the build, catching a paraphrase that cuts an edge the machine still
believes in. Plurals are deliberately unmatched, since stemming is a guess about English.

**The description is a third re-opening axis, alongside a term being redefined.** `touched`
compares each requirement's own description against the same base revision the tests are
measured from, and a reworded one re-opens every scenario under it through the same
gathering path as a changed term — the same work list, the same gate — because the
description is the standard a claim is judged against, and a reworded standard is a
different question. A requirement new to the working tree counts as changed; one left byte
for byte unchanged re-opens nothing.

## 37. The dispatch agent — async programming on top of the gates

**The thesis.** A background task queue is not new — every harness has one. What none of
them have is the human's judgement points *inside* the queue's own state machine: either a
human watches the whole run (synchronous work wearing an async costume), or nothing holds
the agent to a reviewable contract. ProofSpec's review gate (§32) is that contract. So the
product is not the scheduler; the scheduler is the mechanism that executes the contract, and
the contract is the product.

**Three roles, decoupled by the gate — this is the scope each agent persona is handed:**

- **The investigation agent (`investigator`)** owns everything up to and including the
  disposition review — the one synchronous moment, where a human judges every rewritten and
  new requirement's prose before it lands. It drafts the real reworded/new/gone census
  across every requirement and TERM the intent touches (§42, §50), commits the settled prose
  onto the TASK's own branch, and only then hands off to the queue by calling `enqueue_task`
  (§48).
- **The dispatch agent (`schedule`)** owns the queue between them: ordering, dependency
  edges, conflict avoidance, dispatching, notification. It never judges intent (§41).
- **The work agent (`executor`)** owns everything after hand-off: red tests, build, review
  reactions, merge — unattended, all the way to merge. Because the disposition review
  pre-judges everything the branch will touch, the merge door degenerates into a mechanical
  check. A TASK has exactly one sync point, with one exception path: when a build proves a
  judged standard itself wrong, the executor asks and the task parks.

**Scheduling reads artifacts, never transcripts.** Reading another agent's conversation to
infer progress or overlap is probabilistic guessing. Every agent-to-agent handoff is a
machine-readable MANIFEST instead (§40): intent ref, branch, base — read fresh from git on
every call rather than trusted as a declared footprint, because a description of an edit can
disagree with the edit, and the branch is the record.

**Notifications may be relayed; verdicts may not.** A dispatcher that can generate authority
on a human's behalf is the single most dangerous component this design could have. So a
blocked executor writes an ASK and parks; the scheduler only ever relays a pointer ("task X
is waiting on a ruling, answer in its session") — the ruling itself is typed by the human in
the work agent's own session and carries its own provenance there. "The user has ruled" must
trace to a record, never to a dispatcher's own claim.

**State lives in files; every process is a stateless reader and writer of them.** This is how
the merge lock already works (a `mkdir`, released by any crash) and how the queue follows the
same discipline: an append-only event log, one directory per TASK holding its manifest and a
one-word state written atomically — `queued → building → mergeable → merged`, plus the parked
states `held-for(X)` and `blocked-on-question` and the failure state `gate-failed`. No
resident scheduler process, no in-memory queue: a scheduling pass wakes on an event (a TASK
enqueued, merged, or a session starting up) and recomputes everything fresh from git and the
queue directory, so any session or CLI invocation can pick the state back up cold.

## 38. Every TERM has one home, and the guard says so

Folded into §34: every TERM's home is named, not inferred (`specs/glossary.md`), and enforced
by two guard rules that fail rather than warn — a term defined twice, or defined outside the
named home. Both are unambiguous the moment a second definition or a second home exists, so a
warning would have been a fix deferred for no reason.

## 39. A queue entry outlives its TASK, until nothing still names it

Once a TASK merges, its queue subdirectory cannot simply be deleted, because the graph tells
"based on a TASK that merged" apart from "based on a TASK the queue holds no record of"
purely by whether that subdirectory still exists. So a merged entry stays — never removed —
for as long as anything might still ask about it; the scheduling pass prunes it once no
in-flight TASK's own base still names it, answerable from the same graph `inflight` already
computes, so the pruner keeps no bookkeeping of its own.

The `merged` word has exactly one producer: the scheduling pass, which rewrites a TASK's
state to `merged` only when both hold — the TASK's state word is `mergeable`, the executor's
own claim the work is done, and the TASK's branch is an ancestor of `main`, checked fresh
from git on every pass. Each condition covers the other's blind spot: a branch is an
ancestor of `main` from the moment it is cut, so ancestry alone would settle a freshly
queued TASK before any work happened, and `mergeable` alone is only a claim. The executor
cannot report `merged` itself (`report_task_state`'s closed set excludes it, §51) — a
session that just did the merging is the least impartial judge of whether its merge landed.
The same settle removes the TASK's worktree at its conventional path and kills its
same-named tmux session on the dedicated server: the executor's own session lives inside
the worktree being removed, so the teardown is the pass's move, never the executor's — and a
leftover worktree registration is the exact collision a later dispatch of that name dies on.

## 40. The MANIFEST carries a branch, not a declared footprint

The original sketch of this design asked a TASK to declare its own footprint when it
enqueues — which files, which terms, which capabilities it depends on. What shipped instead
carries three fields: `intentRef`, `branch`, `base`. Everything else is read from git, on
every run, relative to each TASK's own merge-base, because a description of an edit can
disagree with the edit, and the branch is the record. `inflight` (§43) reports; it holds no
queue and orders nothing itself — deciding what to do with what it reports is `schedule`'s
job, one layer up, and `schedule` is the one that needs a TASK's declared *intent*, which
`inflight` never reads at all. A `base` naming a TASK absent from the queue is carried as an
unresolved claim and reported as a problem, never silently defaulted to `main` — the same
"go and look, don't trust a description" rule the rest of this tool applies to tests.

## 41. `schedule` — the orchestrator built to hold no intelligence of its own

**No daemon, no message queue, no PID liveness check.** All three were live options and all
three were rejected: a resident scheduler is one more process to keep alive and trust; a
message queue is state to keep consistent that a fresh recompute makes unnecessary; and a PID
means something only on the machine that started it, when every other judgement this tool
makes already reads state from files, never from what happens to still be running.

**LEASE, not a lock: two scheduling passes finding the same ready TASK is the expected case,
not a race to defend against.** A global lock over the whole queue was rejected because it
would hold every other TASK's dispatch hostage to the one TASK a pass happened to be looking
at. A LEASE is scoped to one TASK: taking it is a plain `writeFile` with the `wx` flag, so the
OS's own `EEXIST` on a second attempt *is* the collision detection — no read-then-decide-then-
write window for two passes to both fall through. A LEASE is never renewed and carries no
liveness signal of its own: it goes stale, and becomes reclaimable, once a grace period passes
with the TASK's state never advancing to the literal word `building` — the one state change a
real session makes almost immediately, whether it died, never started, or is running on a
machine nobody is watching. *Shipped once wrong:* the first cut decided staleness by reading
the LEASE, then unconditionally clearing and re-taking it in two separate calls, leaving a
window where a second pass could clear a LEASE the first had just retaken; the fix nests the
clear-and-recreate behind its own `mkdir`-based exclusive lock and, inside it, re-reads the
LEASE and refuses to proceed unless it still holds exactly the stale value that justified
reclaiming it — a real compare-and-swap, not just a narrower window.

**A relationship is judged by a fresh agent before any human sees it, and the human is the
one thing this design refuses to let anything else impersonate.** `inflight` finds a
relationship by reading files, never intent; `schedule` hands every relationship a fresh
`judge` call (§44), along with both TASKs' intent, and asks whether it is a real conflict —
most shared ground between two TASKs is coincidence, not conflict. Only what the judge could
not resolve reaches a human, and the `RaisedEntry` ledger type makes the one rule that matters
structural rather than merely documented: its `ruled` variant's `ruling` field has no path
back to a `JudgeVerdict` at all, so nothing a fresh agent computes can ever end up written
there as if a human had ruled it.

**The one thing this capability remembers across runs, on purpose.** Everything else —
holds, pruning, readiness — is answerable fresh from git and the queue every time. Asking a
human about the same unresolved relationship on every pass would not respect that they
already saw it once, so a small durable ledger (`.proofspec/schedule/raised.jsonl`, one line
per event, appended, never edited) records that a relationship was raised, and a `ruled` line
records what the human actually wrote — the only thing this capability remembers, and a
deliberate exception to computing fresh and storing nothing.

`schedule` takes `startSession` (§45), `judge` (§44), and `notifyHuman` (§46) as actions
supplied by an embedder; the bare CLI now supplies real implementations of all three.

## 42. The investigation agent's census has to read the queue, not just `main`

With more than one TASK in flight, a census that reads only its own worktree's specs judges
against a base that is stale the moment a sibling TASK is mid-rewrite of the same
requirement — the same two-boats-rewriting-the-same-prose pain ordering exists to avoid at
merge time, just moved earlier, to draft time, where nothing previously caught it at all.

**Reading for context is not the same relationship as building on top of.** Wanting to know
what another TASK currently says about a term is not a build dependency, so it does not
belong in the MANIFEST's `base` at all — reading via `git show <branch>:<path>` rather than a
live worktree checkout is enough, since a TASK counts as in flight by its queue entry, not by
whether a checkout for it still happens to exist on disk.

**A cheap filter has to come before the expensive read, or the cost tracks the wrong number.**
Reading every in-flight TASK's full spec files on every census would make the cost scale with
how many TASKs are queued, not with how many actually overlap. `inflight` already computes,
fresh from git on every run, which in-flight TASK touches which capability file and term — the
census asks that graph first, and only reaches for the expensive per-branch read on whichever
TASKs the filter actually names. (Closed by `handoff`'s `census_in_flight`, §50.)

## 43. `dispatch` is renamed `inflight`

The read-only graph capability §40–§42 describe is named `inflight`, not `dispatch`. The word
was doing two jobs: `dispatch` also names the one English verb for what `schedule` actually
does (dispatch a ready TASK into a session), so a reader meeting a `dispatch` command
reasonably expected it to start something, when the capability itself only ever reads the
queue and answers a graph. `inflight` names the subject the capability actually reports on —
every TASK currently in flight, and how they relate. The on-disk queue directory keeps the
name `.proofspec/dispatch/`, since it is a stored format, not this capability's identity, and
renaming it would be a breaking migration in service of a question the directory itself was
never implicated in.

## 44. `judge` — a disposable agent with no memory and no tools

Deciding whether two TASKs' intents genuinely conflict needs judgement, but the judge must be
provably unable to have touched either TASK's branch, not merely trusted not to have.
`pi -p --no-tools --no-session --no-context-files` gets there structurally: a one-shot process
with no tools and no memory cannot read a file or carry a bias forward even in principle.

**The contract lives in the last line of the reply, not in a JSON mode.** The system prompt
necessarily explains both `RESOLVED` and `UNRESOLVED`, so a parser reading the whole reply
could never tell the agent's own explanation of the contract from its actual answer.
`verdictFrom` reads only the last line, case-folded and stripped of punctuation — total by
construction, since a process that never ran, crashed, said nothing, or hedged in prose all
collapse onto `unresolved`, the same value a genuinely undecided judgement already reads as.
There is no third case: `unresolved` already costs exactly one human glance (§41's ledger
ensures it happens at most once), and a third value would only need collapsing back to one of
the two that exist.

**Gotcha, found only by running it for real:** `pi` reads its own stdin when it is not
attached to a TTY, and a Promise-wrapped `execFile` hides the handle needed to close it — so a
real invocation hung for the full timeout on every call, never once reaching a verdict, with
every unit test (which uses a fake runner by design) green throughout. The fix closes
`child.stdin` explicitly, the instant the process starts.

## 45. `startSession` — a headed, interactive work-agent session, in tmux

A headed process needs a real pty, and a scheduling pass has none of its own. `pi` without
`--print` is already the interactive session `schedule` needs to start; tmux is what hands it
a terminal — a detached `tmux new-session -d` brings the TUI up, a human reaches it later with
`tmux attach`, and a positional message argument seeds the first prompt without breaking
interactivity. `.proofspec/worktrees/<task>` (not `.claude/worktrees/<task>`) is this tool's
own on-disk convention, the same kind of thing the queue directory already is, kept separate
from any one editor's own layout. `startSession` checks the conventional path first and
creates a worktree on demand rather than asking `git worktree list` a question the path
convention already answers; a second call reuses the existing worktree unchanged.

## 46. `judge` and `notifyHuman` join `startSession` as bare-CLI defaults; `enqueue` gets its primitive

`notifyHuman` ships as the minimum that respects the CLI's own contract: stdout carries the
one line a program parses, so any human-facing text has exactly one channel left, stderr — one
message there naming the shared node, both TASKs, and the relationship's own key, enough for a
human already watching the process to answer directly. With all three actions real, an
embedder now exists only for someone who wants to *override* one of them, never merely to
supply one, since the bare CLI already does.

**`writeState` and `enqueue`: the write primitives the queue directory was still missing.**
`writeState(cwd, task, word)` is a total, unjudging overwrite — validating a transition (only
`building` may become `merged`) is deliberately not built, since no caller needs a specific
verb like `markMerged` yet. `enqueue` lays down a TASK's directory and MANIFEST, then calls
`writeState` for the initial `queued` word, and refuses rather than overwrites a name already
in the queue using the same `wx`-flag idiom `takeLease` already uses — two callers racing to
enqueue the same name collapse onto the one filesystem call the OS already makes atomic. There
is deliberately no `proofspec enqueue` CLI verb: nothing calls this function yet outside
`handoff` (§48).

## 47. Every session `startSession` opens runs on its own tmux server

A real run against a real queue once issued `tmux kill-session -t a` for a TASK named `a` and
killed a human's own, unrelated tmux session named `audan` instead — tmux does not require an
exact match for `-t`; given no session named exactly `a`, it falls back to a prefix match, and
`audan` was the only session starting with `a` at that moment. A task name never has to
collide *exactly* with anything real for this to happen, only be a prefix of it. The fix is
the same shape every other real hazard in this design gets: stop sharing the resource, not
detect the collision. `tmux -L <socket>` opens a genuinely separate server (`proofspec` by
default, `PROOFSPEC_TMUX_SOCKET` overridable), so a real work-agent session lives somewhere
nothing else, human or tool, is ever running anything.

## 48. `handoff` — the investigator's own interface to the queue

`handoff` is a `pi` extension registering one tool, `enqueue_task({task, intentRef, branch,
base?})`, so a human can talk a TASK's intent through with an agent and have it hand off to
the real queue instead of a hand-written MANIFEST — a flattening of the exact MANIFEST shape
`readManifest` already parses, one `kind` tag inferred from whether `base` was given at all.

**`enqueue_task` is the first caller that hands `enqueue()` a `task` it did not already
trust.** Every caller before it was a human typing a name or a test fixture; a tool argument
shaped by a model's own text is a different kind of input, so `checkTaskName` gates a plain
kebab-case slug — letter-initial, lowercase, hyphen-joined, no trailing hyphen — before
`enqueue()`'s own path-join ever sees it, refusing a traversal attempt as the path it is
rather than the TASK name it is not.

Shipped alongside the tool: `.pi/agents/investigator.md`, a persona that reads the current
`inflight` graph and `specs/*.md` before proposing a TASK name or base, and calls
`enqueue_task` only once a human has confirmed all four fields, never speculatively.

## 49. `investigator` absorbs disposition review; `worker` splits into `implementer` and `executor`

The first cut of `investigator.md` talked a TASK's intent through and called `enqueue_task`,
but never touched `specs/*.md` — the disposition review §37 names as the investigation
agent's own defining act had nowhere to happen. `investigator.md` now drafts the real
die/rewrite/keep census itself, commits the settled prose onto the TASK's own branch, and only
then confirms the four `enqueue_task` fields.

**`worker` was one name asked to mean two different things.** The unattended, headed session
`startSession` opens is what §37 calls the work agent — but `.pi/agents/worker.md` was
actually a narrow, synchronously-dispatched persona for one step of the `ship` skill's own
pipeline (`tests-red` or `build-green`, no autonomy over what happens next). It is renamed
`.pi/agents/implementer.md`, reading off what its own frontmatter already said it does. The
new top-level persona for `startSession`'s own session is named `executor`, not `worker`
reused: it is the only role in this design that does not judge anything, only carries out a
disposition already judged, all the way to merge — precisely what "executor" already means
here. `.pi/agents/executor.md` is real prose with nowhere automatic to run — nothing
dispatches the session `tmuxStartSession` opens, so `--append-system-prompt` is what gets it
there, added to (not replacing) `pi`'s own default prompt, with the persona file's own YAML
frontmatter stripped first.

**Left open at the time, since closed by `progress` (§51):** there was no way for a running
executor session to report its own state (`building`, `mergeable`, `blocked-on-question`)
back into `.proofspec/dispatch/<task>/` — that directory lives in the main checkout, the
executor runs inside the TASK's own worktree, and nothing bridged the two yet. This mattered
for real: `schedule`'s own LEASE-reclaim logic (§41) already depends on state advancing to the
literal word `building` as the one signal a real session produces — a signal nothing yet
produced.

**Drafting has since left the investigator's own hands.** The investigator this section
describes drafted every die/rewrite/new row's prose itself, inside the same conversation that
talked the intent through — a poor judge of its own fresh wording, for the same reason the
pipeline's reviews go to fresh subagents, and a conversation that remembers the drafting
tells the reader how the draft got there instead of why today's design is right. A fresh
**spec writer** persona (`.pi/agents/spec-writer.md`) now drafts, one pass per spawn: the
investigator hands it the settled disposition rows, the intent in the human's own words, and
the worktree root, and it writes prose into `specs/*.md` and nothing else — never a
disposition, never a commit. The conversation holder keeps what only it can hold:
orchestrating the intent, owning the branch and the commits, running the disposition review.
The house prose discipline — a rationale states the current, correct design, never the
history of how the draft got there — has its single home in the persona that writes under it,
no longer living only in the legacy `ship` skill the investigator was never pointed at.

## 50. `census_in_flight` closes §42's gap

`investigator.md`'s own "census, then draft for real" step leaned on `inflight` for a graph
that answers node *names* only, never prose. `census_in_flight`, a tool beside `handoff`'s
`enqueue_task`, answers what every in-flight TASK's branch has actually reworded, added, or
removed, relative to its own base — carrying the prose as it stands there, not just the fact
that a file moved.

**Ownership follows the existing split exactly.** The read — resolve a TASK's basis, diff its
base against its branch tip, parse and compare requirement/TERM prose — is `inflight`'s shape
(`computeCensus`, `changedRequirements`, pure functions), mirroring `changedTerms` (§34) arm
for arm: reworded, new, gone, and no arm for a row that did not move. The git half (resolving
each in-flight TASK's basis, reading before/after text, parsing each capability file) is
`cli`'s job, exactly as `inflight`'s own graph already draws that line. `census_in_flight`
itself is the thinnest possible wrapper on top, matching `enqueue_task`'s own shape.

**No trace, on purpose.** The census is computed fresh from git and the queue on every call
and remembered by nothing — the same discipline `inflight`'s own graph already keeps. A
ledger like `schedule`'s exists only because a human's ruling on a relationship must not be
re-asked; a census has no analogous case.

**One vocabulary for "diff a spec row against its base."** `inflight`'s census classifies a
row reworded / new / gone; the `ship` skill's own older, unrelated file-scanning census used
die / rewrite / keep for the same three outcomes, plus a fourth (`kept`) for a row that did
not change, which `inflight`'s census has no need of since it only ever lists rows that
changed. `reworded / new / gone` is the one spelling for this now anywhere in the tool, with
`kept` as `ship`'s own added category for an unchanged row.

**Who reads it.** Nothing in `schedule`'s own mechanical work (settling, pruning, holds, LEASEs,
dispatching) needs to classify a spec change — only a human or the investigator judging one
does, and both reach it through `handoff`'s `census_in_flight` tool, never through `schedule`.

## 51. `progress` — closing the gap §49 left open

`progress` registers `report_task_state`, letting a running executor session write `building`,
`mergeable`, or `blocked-on-question` straight into `.proofspec/dispatch/<task>/` in the main
checkout, even though the session itself runs inside the TASK's own worktree — a different
directory by construction, not by an oversight.

**Addressing across the boundary is the scheduler's job, not an inference.** An extension only
ever gets `cwd`, and `cwd` for a session `startSession` opens is the worktree, not the main
checkout the queue lives under — no path computed from `cwd` alone ever names the queue
correctly for every session. `startSession` already holds both facts the moment it starts a
session, so it hands them down as `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` environment
variables on the tmux `new-session` command. `report_task_state` refuses outright, naming
whichever is missing, rather than falling back to `cwd` or guessing.

**Two gotchas found by reading `pi`'s own source before either shipped:** `pi`'s project
trust is keyed per directory, and a freshly-created worktree is always unknown to it, so the
default `ask` policy means a startup prompt nobody can answer in a detached tmux session —
`pi --approve` sets pi's own trust override and skips it. And `.pi/` is tracked in git, so a
worktree's own copy of an extension file is whatever commit its branch happened to cut from —
a branch cut before this capability existed carries no such file at all, so `pi --extension
<queueRoot>/.pi/extensions/progress.ts` pins the tool to this tool's own checkout instead.

**`report_task_state` reports a word, not a question.** `blocked-on-question` carries no free
text; a human reads the actual question by attaching to the session's own tmux window. `merged`
is deliberately not in the reportable set either — a session that just did the merging is the
least impartial judge of whether its merge landed. The word has exactly one producer, the
scheduling pass (§39), which writes it only after checking the branch landed in `main` itself.

## 52. Naming cleanup

Three narrower gaps a plain read of the specs, tests, and personas turned up once §50 and §51
landed: `schedule` does not consume the census (§50) — nothing in its own mechanical work
needs to classify a spec change, only a human or the investigator does, through `handoff`.
`executor` (§49's rename) is the one name now used consistently everywhere a persona or a
requirement heading refers to the unattended top-level session — `specs/schedule.md` and
`specs/glossary.md` no longer say "work-agent." And `dispatch` keeps exactly one live meaning
(§43): the verb `schedule` performs, and the literal `.proofspec/dispatch/` directory name —
not the `subagent` tool's own frontmatter convention, and not an unbuilt orchestrator role,
both of which are now named plainly instead.

---

## 53. `Docket` — the pipeline's own name

`proofspec` names the spec↔test↔code contract (§1–§34); the investigator/schedule/executor
pipeline that executes it (§37–§52) is named **Docket**. It reads on the courtroom
vocabulary this design already speaks — `judge`, `ruling`, `disposition review`, the
reviews ledger — rather than introducing a new metaphor: investigator puts a TASK on the
docket, schedule manages the order cases are heard in, executor carries out the ruling.
Strictly a docket is the calendar of cases, not the court itself, so the name is a metonymy
carried with open eyes: the queue of pending TASKs is the artifact that makes this pipeline
what it is, and the `docket` command that shows it (§55) is where the word does its most
literal work. Other names floated in the conversation that settled this one — `Relay`,
`Warrant`, `Loom`, `Slipstream`, `Offload` — none spoke the design's own vocabulary.

**The package and the binary keep the name `proofspec`, deliberately.** The earlier open
question — rename the package, demote `proofspec` to an internal dependency — is deferred,
and the deferral is itself the decision recorded here: Rule 3 (YAGNI) still argues against
a code- or package-level rename while the pipeline's shape is moving, and nothing in the
specs or the tools depends on the pipeline having a package of its own. Revisit when the
shape settles, not before.

---

## 54. The live-session bound — capacity read from the server, never from state words

Nothing in §41–§47 bounds how many executor sessions may stand at once: every ready TASK
dispatched in one pass starts a session, and a queue of ten ready TASKs starts ten headed
`pi` processes on one machine. The bound is four by default, `PROOFSPEC_MAX_SESSIONS`
overridable, and the count it is compared against is `tmux -L <socket> list-sessions` asked
of the dedicated server fresh at every dispatch decision — never a count the pass keeps,
never a reading of TASKs' state words.

Counting the server is counting exactly the sessions this tool started: §47's socket
isolation means nothing else runs there, and a session that dies — executor finished,
machine rebooted, tmux killed by hand — shortens the list on its own. A TASK's state word is
the wrong measure for the same reason the LEASE reads elapsed time rather than a process:
a session is alive through its whole start-to-`building` window and past `mergeable` while
it still merges, so a pass counting words would overshoot the bound in exactly those
windows. A malformed override falls back to four rather than silently disabling the bound,
because the obvious malformed readings parse to `NaN` and every comparison against `NaN` is
false — a pass holding `NaN` would dispatch without limit while believing itself bounded.

A TASK the bound leaves undispatched keeps its state word `queued` and takes no LEASE:
nothing about the TASK changed, only the machine's capacity did, and capacity is no state of
the TASK's own. The settle step of the same pass already kills a merged TASK's session
before dispatch runs, so a freed slot is there for the next pass to see — the bound needs no
producer of its own. What the bound does not promise: two passes triggered at the same
instant can each see three live sessions and each start one, five briefly. Closing that
window would take a lock over the whole queue — the exact thing the LEASE requirement
declines to build — and the LEASE already prevents the common double-dispatch, two sessions
for one TASK.

---

## 55. `docket` — one glance at the queue

`inflight` answers how in-flight TASKs relate, as JSON for a program; `schedule` acts on
the queue and says what it found on the stderr of the pass that found it. Nothing between
them gathers what a person wants while several executor sessions run: each TASK's own word,
whether its session is still there to attach to, how long it has stood where it stands,
when it last moved, and which rulings are still outstanding. `docket` is that one glance —
one row per queue entry, plus every raised-but-unruled relationship with the exact command
to rule on it.

**Every fact is read from where some other capability already wrote it.** The queue
directory `enqueue` writes, the raised-relationships record `schedule` keeps, the heartbeat
`progress` refreshes, the session list of the very tmux server `startSession` runs sessions
on. Ages are read from the files' own write times — no log is kept, because the filesystem
already records when each word took hold and when each move happened. Session presence is
the server's own answer about what it holds, not the process-probe §41 refuses: listed is
attachable, absent is absent, and neither is interpreted.

**No `running` word, on purpose.** The state vocabulary keeps its rule — every word has
exactly one honest producer — and `running` has none available: the session cannot promise
its own future (it writes the word, then hangs, and the word stays), and the view cannot
observe activity without the very probe this design refuses. What a person actually wants
is *how long since the last move*, and that is a fact, not a word: `progress`'s heartbeat,
refreshed by the session's extension on every observable move — a turn, a tool call, a
streamed reply, a subagent's step arriving as a tool update — going stale on its own the
moment moves stop. The view carries the number; the human judges it.

**Reports only.** No gate, no writes, no ordering beyond TASK name, no judgement about
holds, sessions, or relationships — every decision a docket row might tempt already belongs
to the capability that makes it. Text by default because a person is its reader; JSON on
request like every other command.

The pipeline's own name (§53) and this capability's are the same word on purpose: the
command shows what the pipeline is named after — the docket itself.
