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
npx proofspec touched  # name the scenarios this branch's changes touched
npx proofspec impact   # walk from changed source, up the call graph, to the tests that reach it
```

Tests are read from `tests/` and capability files from `specs/` by default
(`--tests` / `--specs` to change). `write` fills the scenario blocks of capability
files you author, so create `specs/<capability>.md` before the first write.

### What did this change touch?

`touched` reads the changes to your tests and names the promises they reached:

```sh
npx proofspec touched              # since this branch left main
npx proofspec touched --since HEAD # since the last commit
```

```
touched since 7cdd20f

tests/cli/touched.test.ts:32  A change inside a proof names the scenario  [the claim changed]
    cli → A command says which scenarios a change touched  → specs/cli.md:112
tests/cli/support.ts:128-161  changed outside every proof
```

A proof runs from its `// Requirement:` line to the last line of its test, so editing the
Gherkin counts as touching the scenario — and is reported as the claim changing, not the
proof. Changes to a helper or a fixture are listed as touching nothing. A proof the change
deleted is read back from the base revision and reported as no longer proven.

It counts the working tree and files git has never seen, not only what is committed, and it
always exits zero: it reports, it does not judge. The command that fails a build is `check`.

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
changed. **The unit is the test file, not the scenario**: a graph records one call edge per
test file, and every test in a file usually calls the same entry point. Narrowing further
would take per-test coverage.

### Output formats

The `check` command supports multiple output formats for different use cases:

```sh
npx proofspec check --format text       # Human-readable (default)
npx proofspec check --format json       # JSON for CI/scripts
npx proofspec check --format quickfix   # file:line:E/W:msg (nvim/vim quickfix)
npx proofspec check --format diagnostics # LSP diagnostics format (JSON)
```

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
