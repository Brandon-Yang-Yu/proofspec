# ProofSpec

A thin layer that makes your **test suite the living spec**.

Write each behavior as Gherkin — plain English in WHEN/THEN steps — directly above
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

## Status

Bootstrapping. The `test-scan` capability's tests are written and red; the scanner they
describe is the next thing to build. The full decision record is in
[`docs/design.md`](docs/design.md), the capability specs in [`specs/`](specs).
