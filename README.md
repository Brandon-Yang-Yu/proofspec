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

## The way you use it: the Docket pipeline

The commands are not the product. The product is a pipeline — **Docket** — that turns
work into TASKs a coding agent builds unattended, with your judgement held at the points
where only a human can give it:

1. **Work enters as a TASK in a queue.** You talk a TASK's intent through with an
   investigator session. It drafts the requirement prose the TASK will settle on, and
   hands you the **disposition review** — the one synchronous moment in the whole
   pipeline, where you judge every rewritten and new requirement's prose before it
   lands. Until you have judged it, nothing builds.
2. **An executor session builds the TASK unattended, all the way to merge.** Once the
   prose is judged, the hand-off is final: the executor writes the tests, proves them
   red for the right reason, builds to green, and runs its own review gates. It never
   comes back to reopen a requirement's wording; the only thing that stops it is a
   build proving a judged standard itself wrong, and that parks the TASK on a question
   for you.
3. **You watch progress on the docket.** `proofspec docket` is one glance at the queue:
   a row per TASK — its state word, how long it has stood there, when its session last
   moved, and whether that session is still there to attach to. With `--serve` the
   same docket becomes a page over HTTP, refreshing itself, until you stop it.

```sh
npx proofspec schedule        # one scheduling pass: dispatch every ready TASK,
                              # settle one whose merge landed, prune one nothing names
npx proofspec docket          # the queue at a glance
npx proofspec docket --serve  # the same docket as a page at http://127.0.0.1:4567/
npx proofspec inflight        # how the in-flight TASKs relate to one another
```

Nobody watches the executor work. The contract it is held to is the review gate: every
test it writes is re-read by a fresh reviewer, every change it makes to a test file
re-opens the question *has a human judged what this promise says?* — and the gate only
closes when the answer is yes. The commands below are that gate's tools.

The decisions and their reasons — why a LEASE and not a lock, why the judge is a
one-shot process, why the page owns no clock — are recorded in
[`docs/design.md`](docs/design.md). This page tells the story; that one keeps the
arguments.

## From zero: adopting ProofSpec in a project that already has tests

You do not need a new project, and you do not need to write a spec first. The first
TASK in your queue is the retrofit of the project you already have — and because the
project has no spec yet, that TASK carries an intent document only: there is no spec
prose to settle at a disposition review. Its executor session builds the spec tree
itself — it creates `specs/`, writes the Gherkin above your existing tests, and gets
`check` green. From that first TASK on, you are inside the Docket workflow.

You need: Node ≥ 20, a TypeScript test suite, [pi](https://github.com/earendil-works/pi)
(the coding agent the pipeline drives), and tmux (where the executor sessions run
headed). ProofSpec currently supports TypeScript test suites only.

**1. Install the package.**

```sh
npm install -D proofspec   # or: pnpm add -D proofspec
```

(Or install a tarball you built from a checkout:
`npm install /path/to/proofspec-<version>.tgz` — the same layout.)

**2. Copy the personas and the extension glue out of the installed package.** The
package ships the nine pipeline personas — investigator, executor, intent-writer,
planner, implementer, test-reviewer, completion-reviewer, guideline-reviewer,
acceptance-checker — and the two extension files that give a pi session the queue
tools (`enqueue_task`, `census_in_flight`, `report_task_state`, `report_task_phase`,
`settle_task`):

```sh
mkdir -p .pi/agents .pi/extensions
cp node_modules/proofspec/.pi/agents/*.md .pi/agents/
cp node_modules/proofspec/.pi/extensions/handoff.ts .pi/extensions/
cp node_modules/proofspec/.pi/extensions/progress.ts .pi/extensions/
echo ".proofspec/" >> .gitignore   # the queue and its worktrees are runtime state,
                                   # never committed
git add .gitignore .pi package.json package-lock.json   # or pnpm-lock.yaml
git commit -m "chore: adopt the ProofSpec docket pipeline"
```

Commit them: the queue reads the personas from the project root, and a TASK's worktree
branches from what is committed. Commit your tests too, if they are not yet. The
personas ship as this repo runs them — written against its own conventions (pnpm
scripts, a codebase-memory index, its agent rules); your copies in `.pi/agents/` are
yours to edit.

**3. Queue the retrofit TASK.** Start pi in the project and ask for the first TASK
(`--approve` trusts the project-local files for this run). There is no spec prose yet,
so nothing needs a disposition review — one ask is enough:

```sh
pi --approve -p "Queue my first TASK, named retrofit: turn this project into one ProofSpec can run. Do the investigator's setup — a branch and worktree for the TASK, and its INTENT doc in the queue entry — then enqueue it. The TASK's intent: create specs/, write the Gherkin above the existing tests, and get check green. There is no spec prose yet, so this TASK carries an INTENT doc only; there is nothing to settle at a disposition review."
```

The session sets the TASK up the way the investigator does — a branch of its own, an
INTENT doc in `.proofspec/dispatch/retrofit/INTENT`, then `enqueue_task`. A successful
enqueue immediately triggers a scheduling pass, which starts the executor session as
soon as capacity allows.

One bootstrap wrinkle, on the first TASK only: a pass reads the spec tree to judge how
TASKs relate, and a project with no `specs/` yet has none for it to read. Create the
empty directory once — filling it is the retrofit TASK's own first work — and dispatch
the TASK:

```sh
mkdir specs            # the empty tree a pass reads; the retrofit TASK fills it
npx proofspec schedule # starts the executor session for the retrofit TASK
```

Every TASK after the first one opens the proper way: start `pi` and talk the intent
through with the investigator. That conversation — and the disposition review it hands
you, where you judge the settled prose — is the whole of your synchronous work.

**4. Watch it.**

```sh
npx proofspec docket          # one row: retrofit, and its state word
npx proofspec docket --serve  # then open http://127.0.0.1:4567/
```

The executor session runs headed inside tmux, on a server of its own — the docket's
row carries the exact `tmux attach` line whenever you want to watch it work, and
nothing requires you to. When the TASK's tests are green and every gate is clean, the
executor merges and the TASK settles; the row leaves the queue for the archive.

Every TASK after the first one goes through the full story above: talk the intent
through, judge the prose at the disposition review, watch the row. Work that is too
small to be worth a TASK can still use the commands directly — they are the same
tools the pipeline itself runs.

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

## The commands in detail

Tests are read from `tests/` and capability files from `specs/` by default
(`--tests` / `--specs` to change). `write` fills the scenario blocks of capability
files you author, so create `specs/<capability>.md` before the first write.

```sh
npx proofspec check    # rebuild the spec tree from the tests and report drift; never writes
npx proofspec write    # record what the tests prove into specs/
npx proofspec render   # write the readable spec site to build/ (build/spec.md is the whole spec in one page)
npx proofspec touched  # what this branch touched, and what nobody has reviewed yet
npx proofspec review   # record one reviewer's judgement of one promise it reached
npx proofspec impact   # walk from changed source, up the call graph, to the tests that reach it
```

`check` is the drift gate — the command that fails a build when the tests and the
committed spec files disagree. `write` and `render` are how the tree's own state gets
recorded and read. `touched` and `review` are the review gate the executor answers to,
and `impact` narrows what a change reaches.

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
a reviewer who cannot report a problem without blocking their own branch has a reason to write
a pass instead.

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

## Status

ProofSpec runs on itself end to end: the tool's own suite — 547 tests across the
capabilities in [`specs/`](specs), from `test-scan` and `spec-tree` to the Docket
pipeline's own queue (`docket`, `inflight`, `schedule`, `handoff`, `progress`) — is
built, green, and reviewed through the same gates it ships. The full decision record
is in [`docs/design.md`](docs/design.md).

## Developing

```sh
git clone https://github.com/Brandon-Yang-Yu/proofspec.git
cd proofspec
pnpm install
pnpm test              # run the suite; `pnpm proofspec <cmd>` runs the CLI from source
```

## License

[MIT](LICENSE)
