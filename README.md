# ProofSpec

A thin layer that makes your **test suite the living spec**.

Write each behavior as Gherkin — plain English in GIVEN/WHEN/THEN steps — directly above
the one test that proves it. A small tool reads those tests and builds a tree:

```
capability → requirement → scenario → test
```

That tree *is* the project's spec. It can't drift, because it's generated from the
tests and the build fails when they disagree.

**Why:** when the behavior claim sits next to the test, a person or an AI can judge
"does this test actually do what the claim says?" without leaving the file.

## The model

```
project spec (expressed by tests)
└── capability          e.g. agent-chat
    └── requirement      a high-level promise (one SHALL sentence)
        └── scenario     one detailed condition, written as Gherkin by its proof
            └── proof     exactly one place proves it
```

- **A scenario is `(GIVEN, WHEN) + one THEN`.** Same action, same outcome → the same
  scenario. Inputs that differ only in data are one scenario with a table, not many.
- **One scenario ↔ one proof site** (a bijection). A proof site is a whole test, or —
  when one action proves several scenarios — a block of assertions inside one, with each
  THEN written on the assertion that checks it.
- **Behavior text lives only in the test.** A requirement's file records *where* its
  scenarios are — not a second copy of them.
- **Line numbers are delivered, never stored.** The file keeps stable identity
  (titles + file); a tool resolves the current `file:line` on demand, the way the
  codebase-memory index resolves a symbol's range fresh instead of hard-coding it.

## Quick start

ProofSpec currently supports TypeScript test suites only. Requires Node ≥ 20.

```sh
npm install -D proofspec   # or: pnpm add -D proofspec

npx proofspec check    # rebuild the spec tree from the tests and report drift
npx proofspec write    # record what the tests prove into specs/
npx proofspec render   # write the readable spec site to build/ (build/spec.md is the whole spec in one page)
npx proofspec touched  # what this branch touched, and what nobody has reviewed yet
npx proofspec review   # record one reviewer's judgement of one promise it reached
npx proofspec impact   # walk from changed source, up the call graph, to the tests that reach it
```

Tests are read from `tests/` and capability files from `specs/` by default
(`--tests` / `--specs` to change). `write` fills the scenario blocks of capability
files you author, so create `specs/<capability>.md` before the first write.

### What did this change touch, and has anyone looked at it?

`touched` reads the changes to your tests and says which promises they reached. Asked for
nothing in particular it answers with the work list — one line per requirement, with the
address to fetch it by and how much of it nobody has judged:

```sh
npx proofspec touched              # the work list, since this branch left main
npx proofspec touched --since HEAD # since the last commit
npx proofspec touched --format text
```

```
touched since 7cdd20f — 4 promise(s) still unjudged

  891ce322a64d  cli → A command says which scenarios a change touched
      3 touched, 1 gone, 4 unjudged

14 changed run(s) prove nothing — ask for them with --unmatched
```

Then fetch one requirement and judge what is under it:

```sh
npx proofspec touched --requirement 891ce322a64d   # the claims, the proofs, and the standard
npx proofspec touched --unmatched                  # the changed lines no promise owns
```

The fetched requirement carries everything judging it takes: the prose written under it, every
scenario the change touched with its Gherkin claim and the proving lines as they stand, the key
each is judged under, and the question to judge them by. That is enough to decide whether a
test still does what its claim says without opening a file the report points at.

Splitting the list from the fetch is what makes the loop affordable. This repo's own report was
64,919 bytes when it was one shape; the work list is 2,078, and no fetch on it passes 25KB.

### Recording a review, and holding the gate

Each judgement goes into `.proofspec/reviews.jsonl`, which is committed:

```sh
npx proofspec review <key> --verdict ok    --proves 42 --by "$USER"
npx proofspec review <key> --verdict gap   --note "the THEN promises an order the test never asserts" --by "$USER"
npx proofspec review <key> --verdict drift --note "the claim and the test describe different things" --by "$USER"
```

A pass has to name the line that proves the claim, and the citation is checked against the
proof's own lines and rejected if blank; reporting a problem needs a sentence. The asymmetry is
deliberate — the reviewer is usually the same agent the gate blocks, so the cheapest answer
available has to be an honest one. A `gap` or a `drift` settles its promise just as a pass does:
a reviewer who cannot report a problem without blocking their own branch has a reason to write a
pass instead.

A judgement is filed under a digest of what it judged — the scenario's identity, its
requirement's prose, its claim, and its proving source. Edit any of them and it is no longer
that key, so it comes back unjudged. There is no staleness rule to get wrong.

**The work list exits non-zero while anything it reached is unjudged**, so a pre-push hook can
hold the gate. Fetching a requirement always exits zero — collecting the work is not the gate.
Naming what a change touched is still a report and not a verdict: the command that fails a build
over drift is `check`.

A proof runs from its `// Requirement:` line to the last line of its test, so editing the
Gherkin counts as touching the scenario — and is reported as the claim changing, not the proof.
A proof the change deleted is read back from the base revision and reported as no longer
proven; a pass on one cites nothing, because there is nothing left to point at. It counts the
working tree and files git has never seen, not only what is committed.

### What does a change to the source reach?

`touched` starts at a changed test. `impact` starts at changed *source*: it walks the call
graph backwards from the functions you edited, through everything that calls them, until it
meets the tests — and lists the requirements those tests prove.

```sh
npx proofspec impact                    # since this branch left main
npx proofspec impact --depth 6          # walk further up the call chain
npx proofspec impact --graph graph.json # walk a graph from a file instead of the index
```

```
what this change reaches, since 7cdd20f

renderFullPage  src/locate/render.ts:84
  └─ renderSite  src/locate/render.ts:43
    [test] tests/locate/render.test.ts:296
    └─ render  src/cli/run.ts:82
      [test] tests/cli/render.test.ts:101

to review:
tests/locate/render.test.ts
  locate → The whole spec is rendered as one page  → specs/locate.md:71
     · Every capability is rendered into one full-spec page
     ...
```

The call graph is not ProofSpec's to build: it comes from a
[codebase-memory](https://github.com/Brandon-Yang-Yu/codebase-memory) index of the repo, so
index it first. A graph can also be handed in as JSON — `{ nodes: [...], calls: [...] }` —
which is how the tests give it one.

The tests hang off the function they actually call, so you can see how far each is from what
changed. On its own the unit is the **test file**, not the scenario: a graph records one call
edge per test file, and every test in a file usually calls the same entry point.

### Which scenarios actually ran it?

A call graph says a test file *can* reach the change. A real test run says which scenarios
*did*. Record one, and `impact` narrows to exactly those:

```sh
vitest run -c vitest.coverage.config.ts       # writes .proofspec-coverage.jsonl
npx proofspec impact --coverage .proofspec-coverage.jsonl
```

```
to review (these ran the change):
tests/impact/coverage.test.ts
  impact → The tests that ran a changed function are named from coverage  → specs/impact.md:68
     · A test that ran a changed function is named
     ...
```

On the change that added this feature, the call graph reached 4 test files / 16 scenarios and
the recording narrowed it to 2 files / 12 — the two it dropped can reach the changed code but
never execute it. Setting up the collector takes a config of its own; see
[`docs/coverage.md`](docs/coverage.md).

### Output formats

The `check` command supports multiple output formats for different use cases:

```sh
npx proofspec check --format text       # Human-readable (default)
npx proofspec check --format json       # JSON for CI/scripts
npx proofspec check --format quickfix   # file:line:E/W:msg (nvim/vim quickfix)
npx proofspec check --format diagnostics # LSP diagnostics format (JSON)
```

`touched` answers as JSON unless another format is named, since an agent reads it far more
often than a person does; `--format text` gives the form written for a terminal. Add `--pretty` to any JSON answer to have it indented over several
lines for reviewing by eye; without it the JSON stays on the one line a program parses.

### Neovim integration

ProofSpec includes native support for Neovim:

- **Quickfix format** (`--format quickfix`): Jump directly to findings
- **LSP diagnostics** (`--format diagnostics`): Inline errors/warnings
- **Example configs**: See `examples/nvim/` and `docs/neovim.md`

```sh
# Quick setup with diagnostics
lua require('proofspec').setup()
```

For minimal setup, copy `examples/nvim/minimal.lua` to your config.

### Developing

```sh
git clone https://github.com/Brandon-Yang-Yu/proofspec.git
cd proofspec
pnpm install
pnpm test              # run the suite; `pnpm proofspec <cmd>` runs the CLI from source
```

## Status

ProofSpec runs on itself end to end. All six capabilities — `test-scan`, `spec-file`,
`spec-tree`, `guard`, `locate`, and the `cli` — are built and green (129 tests). The
full decision record is in [`docs/design.md`](docs/design.md), the capability specs in
[`specs/`](specs).

## License

[MIT](LICENSE)
