# Recording which scenarios ran a change

`proofspec impact` reads a call graph, and a call graph reaches a *test file*, never a
scenario inside it: one file's tests usually all call the same entry point. To know which
scenarios actually ran a change, something has to watch a real test run.

That is what the collector does. It is a vitest setup file that records, for each test, the
functions it ran — and the line the test opens on, which is the line its proof site carries,
so a record joins back to the scenario it proves.

## Setting it up

Keep it in a config of its own. Instrumenting every module costs a run that `vitest run`
should not pay: this one is run on purpose, when you want the exact answer.

```ts
// vitest.coverage.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Gives each test the line it opens on. Without it a record cannot be joined to a
    // scenario, and the collector writes nothing rather than guess.
    includeTaskLocation: true,
    setupFiles: ['proofspec/vitest-setup'],
    globalSetup: ['proofspec/vitest-global'],
    coverage: { enabled: true, provider: 'istanbul', include: ['src/**'], reporter: [] },
  },
})
```

`@vitest/coverage-istanbul` has to be installed, at the same version as vitest itself. The
istanbul provider is the one to use: its counters are keyed by function name, which is what
a record is matched on.

Then:

```sh
vitest run -c vitest.coverage.config.ts    # writes .proofspec-coverage.jsonl
proofspec impact --coverage .proofspec-coverage.jsonl
```

The recording is a generated file — gitignore it. `PROOFSPEC_COVERAGE` moves it somewhere
else. The global setup clears it once per run, so what it holds is one run's records.

## What it does and does not catch

**It records the functions a test ran, by name.** Inline callbacks come through as
`(anonymous_3)` and never match anything, which costs nothing: a change inside a callback
belongs to the function around it, and that is the function the call graph reports as
changed.

**Tests must run one at a time within a file.** Attribution is the difference between the
counters before a test and after it, so `it.concurrent` in the same file would mix two tests
together. Files running in parallel are fine: each worker has counters of its own.

**A stale recording is silently wrong.** It says what the code did when it last ran. Re-run it
after changing the code, or `impact` will narrow to yesterday's answer.

## The call graph needs a full index

`impact` also needs the codebase-memory index, and **`--mode fast` is not enough**: measured
on this repo, a fast index held 4 call edges out of the tests where a full index held 170, so
the tree came out with no tests on it at all. Index in full mode:

```sh
codebase-memory-mcp cli index_repository --repo-path .
```

In a worktree, index the worktree itself — the automatic refresh follows the main checkout
only, so otherwise the graph describes `main` while you are reading your own branch.
