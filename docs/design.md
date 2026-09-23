# ProofSpec — the decision record

This file holds only decisions and the reasons behind them — the *why* that cannot be
regenerated from the repository. Everything else has a better home: what the tool does
lives in `specs/*.md`, enforced by `pnpm spec:check`; how the code is shaped lives in the
code; how it got here lives in git history. A sentence in this file that describes current
behavior is a bug in this file — a behavior claim belongs where the guard can reach it.

Earlier versions kept a running narrative of every change and every bug the pipeline
caught. That was git history retold at worse fidelity; it was pruned, twice, and nothing
was lost that `git log` does not hold better. Cite this file by section title, never by
number, so reordering it cannot break a citation.

## The problem

A behavior written twice — once as a spec for the product team, once as a test for
engineers — drifts apart the moment nothing ties them together. ProofSpec's answer is to
write it once: the behavior lives in the test, as Gherkin above its proof, and the spec
files record only *where* each scenario is proven.

The deeper reason for co-location: when the claim sits next to the test, a person or an AI
can cheaply judge "does this test actually satisfy this claim?" Everything below exists to
keep that judgement cheap and to make drift fail the build instead of hiding in prose.

## Principles

1. **Tests are the source of truth for behavior.** To change behavior you change the test.
   No file holds a second copy of a behavior claim.

2. **A scenario's identity is (GIVEN, WHEN) + one THEN.** Same action and outcome is the
   same scenario; change either and it is a different one. This is the rule that says what
   "one behavior" is, so the bijection below has something to count. It is why AND under a
   THEN is banned: an AND admits a second outcome, which is a second scenario. And it is
   why the tree partitions outcomes, not actions — one action may legitimately appear under
   several requirements.

3. **One scenario ↔ one proof site.** A site is a whole test, or a block of assertions
   inside one when several scenarios share its GIVEN/WHEN. Inputs that differ only in data
   ride one parameterised test: the rows differ in the test, not in the promise, so every
   row must reach the same THEN. A shared action keeps one test, each THEN on its own
   assertion — the unit was never "a test", it is "a place that proves one scenario".
   Known cost, accepted: assertions in one test share a fate, so blocks stay independent
   and prefer soft assertions.

4. **A requirement states behavior, never implementation.** The test of a drafted
   requirement: can it be falsified by observing what the tool produces? One that names a
   library, a config format, or a performance target is an implementation detail wearing a
   SHALL.

5. **The guard checks what is mechanical; judgement belongs to a reader.** Whether every
   table row reaches the same THEN, whether scenarios sharing a test really share its
   GIVEN/WHEN — these need a judgement, and a person or an AI reading the co-located claim
   supplies it. ProofSpec reports; it never orchestrates the reading.

6. **Every state word has exactly one honest producer.** `merged` is written only by a
   settle that re-verifies from git that the branch landed, because a session that just
   did the merging is the least impartial judge of whether its merge landed. There is
   deliberately no `running` word: a session cannot promise its own future, and a
   heartbeat that goes stale on its own is a fact, not a claim that can lie.

7. **An index is never a second source of truth.** Anything derived from the repository
   must be reproducible by delete-and-rebuild; an incremental update is a performance
   detail, never a store of its own. A long-lived graph that drifts from the code it
   describes is worse than spec drift, because it is reported with the same confidence as
   the truth.

## Storage vs delivery

The recording format is Markdown, git-friendly and human-readable — but a naive
`→ tests/x.test.ts:42` rots the instant someone inserts a line above the test. So what is
*stored* is the stable identity (a scenario's title and file), and what is *delivered* —
line numbers, jump-to-test, the rendered tree — is computed fresh on every call. Line
numbers never enter a committed file, so editing a test can never produce a false
"spec drifted" diff, and the guard's comparison is immune to line shifts by construction.

## OpenSpec: borrowed from, then dropped

OpenSpec was the starting point, and the plan was a thin layer over it, not a fork — its
tooling was maintained and we did not want to own it. Two things decided against even the
thin layer: its parser discards scenario titles and line numbers (built for validation,
not for the title-and-location indexing ProofSpec needed), and its validator requires a
scenario under every requirement, which makes a requirements-only draft impossible. Two
ideas were borrowed — the nested-header section walk and the code-fence mask — and both
live in `spec-file`'s own code. The propose flow it was kept for was later replaced by the
investigator persona, and no OpenSpec component remains.

## The parser

An AST scan on `oxc-parser`, parse only — no type checker, no `tsconfig`. A line scanner
cannot cut an `it` body into block proof sites without tracking brace, string, and comment
state by hand, and it cannot say "the third statement of `it(...)`, line 30" — a message
read daily, since ProofSpec runs on itself. `typescript`'s `createSourceFile` was the
alternative and lost on two counts: `typescript@7` no longer exports it, so depending on
it meant pinning `5.9` forever; and its one advantage — comments pre-attached to nodes —
cost eighteen hand-rolled lines against oxc's flat comment array, and the hand-rolled
version is stricter (a comment must sit directly above its node), which is exactly what
the syntax rules ask for. The hedge: `test-scan` exposes only `ProofSite[]`, so a
reverting implementation is a one-file change. Cost accepted: pre-1.0, native binary per
platform.

## The CLI's shape

Flags, not a config file: the conventional `specs/`+`tests/` layout needs no describing,
so a config file would be machinery nothing asks for. Directories are walked, not globbed,
and sorted by name — a scan whose order differed per machine could render the tree
differently. A mutating command refuses when the scan reports any error: the guard that
would catch a partial write runs only after the mutation lands, too late, so the command
earns the invariant a reader would assume it had. And stdout belongs to programs — any
message meant for a human goes to stderr.

## The vocabulary

A TERM is defined once in a repo, in one home (the glossary), and means that one thing
everywhere — a word a spec leans on cannot mean one thing in one file and another in the
next. The convention is the matcher: a TERM is one `_`-joined token in the exact form it
was defined. No case folding, no plurals, no stemming — a stemmer is a guess about
English, and the guard does not guess. The hole this closes: before terms, a definition
could be rewritten and every requirement leaning on it changed meaning with no line of any
test moving; keying a review on the definitions its standard uses closes it.

## Spec drift at scale

**The source of truth moves between phases.** In development the test does not exist yet,
so intent → spec → test is the only order. In maintenance the test is the executable
source of truth and the Gherkin above it is its human-readable reading; an interpretation
layer's whole value is that it is cheap to regenerate.

**The repair loop, and why no human is on its default path.** One scenario per proof site
means a real suite carries thousands of scenarios, and any policy that puts a human on the
default path for re-reading a moved scenario does not survive contact with one. So: a test
changes; an AI reads it and states what it now proves; if that differs from the Gherkin
above it, the AI rewrites the Gherkin. Trust in that honest reading is load-bearing —
without it, every step collapses back into a review queue. ProofSpec's whole obligation is
one signal: *this scenario's claim moved, and it moved because these tests did* — the
causal half is what makes the review cheap.

Three wrong turns, recorded so they are not re-walked:

- **Gating on whether the Gherkin text changed** — wrong direction; the test is the source
  of truth, so the test moving is the trigger and the claim moving is an effect.
- **Reserving Gherkin rewrites for humans** — true in development, false in maintenance;
  it reinstates the review-queue arithmetic.
- **Building an escalation ladder** (identity-versus-wording rules, required title
  changes, exception taxonomies) — unnecessary once the tool reports and does not
  orchestrate: every rewritten Gherkin is already read by a person in the commit diff and
  the pull request, a channel that exists anyway.

**The review gate keys on content, not time.** A judgement is filed under a digest of what
it judged — the identity, the requirement's description, the claim, and the source of the
lines that prove it. Change any of them and the scenario comes back unjudged. This is
deliberately not an expiry rule: a staleness check fails silently when it fails to notice,
which is the one outcome the whole apparatus exists to prevent.

**A pass costs more than a complaint, on purpose.** The reviewer and the party the gate
blocks are the same agent, so the gate is shaped by what each answer costs: a pass must
cite the line that proves the claim, checked against the proof's own ranges, while
reporting a problem needs only a sentence. The cheapest honest answer has to be the pass.
The citation does not prove anyone read anything (the source is handed over); what it
forces is a commitment to one claim-to-assertion correspondence — exactly where the
commonest real drift, a claim nothing asserts, cannot hide.

**Mutation, not just review.** Boundary-drawing logic can be wrong in exactly the one
direction that inverts its meaning and still pass green — an off-by-one once reported a
rewritten shared GIVEN as a changed *proof* instead of a changed *claim*, silently, with
everything green. Anything here that draws a boundary earns a mutation pass, not just a
reading, before it is trusted.

## Docket

The pipeline that executes the contract is named **Docket** — the calendar of cases, on
the courtroom vocabulary the design already speaks (judge, ruling, disposition). Naming
decisions are re-litigation bait, so the name and its reason are recorded here once; the
package and binary keep the name `proofspec`.

**The contract is the product; the scheduler is the mechanism.** A background task queue
is not new. What none of them had is the human's judgement points *inside* the queue's own
state machine — either a human watches the whole run, or nothing holds the agent to a
reviewable contract. The review gate is that contract.

**Three roles, one sync point.** The investigator owns everything up to and including the
disposition review — the one synchronous moment, where a human judges every rewritten and
new requirement's prose before it lands. The executor owns everything after, unattended,
all the way to merge; because everything the branch will touch was pre-judged, the merge
door is a mechanical check. The one exception path: a build that proves a judged standard
wrong parks the TASK on a question.

**State lives in files; no process is resident.** No daemon — one more process to keep
alive and trust. No message queue — state to keep consistent that a fresh recompute makes
unnecessary. No PID liveness — a PID means something only on the machine that started it.
A pass wakes on an event and recomputes everything from git and the queue directory, so
any invocation can pick the state up cold.

**A LEASE, not a lock.** A global lock over the queue holds every other TASK hostage to
the one being examined. A LEASE is scoped to one TASK; taking it is a plain `writeFile`
with the `wx` flag, so the OS's own `EEXIST` is the collision detection — no
read-then-decide-then-write window. It is never renewed and carries no liveness signal;
it goes stale once a grace period passes with the state word never reaching `building`,
the one change a real session makes almost immediately whether it lives or dies.
Reclaiming it is a compare-and-swap, not a narrower window: the clear-and-retake sits
inside its own exclusive lock and re-reads, refusing to proceed unless the LEASE still
holds the stale value that justified reclaiming it. (The first cut did this in two
separate calls; the window it left was found the hard way.)

**The MANIFEST carries a branch, not a footprint.** The original sketch asked a TASK to
declare its own footprint — which files, which terms, which capabilities it depends on.
What shipped carries `intentRef`, `branch`, `blocked`, and everything else is read from git on
every run, because a description of an edit can disagree with the edit, and the branch is
the record. It is the same rule the rest of the tool applies to tests.

**Scheduling reads artifacts, never transcripts.** Reading another agent's conversation to
infer progress or overlap is probabilistic guessing; every agent-to-agent handoff is a
machine-readable MANIFEST instead.

**Notifications may be relayed; verdicts may not.** A dispatcher that can generate
authority on a human's behalf is the single most dangerous component this design could
have. A blocked executor writes an ASK and parks; the scheduler relays only a pointer; the
ruling is typed by the human in the work agent's own session. The ledger's `ruled` record
has no path back to a computed verdict, so nothing an agent calculates can ever be written
as if a human had ruled it — structural, not merely documented.

**The judge is disposable by construction.** Judging whether two TASKs conflict needs
judgement, but the judge must be provably unable to have touched either branch — a one-shot
process with no tools and no memory. The verdict is read from the last line only: the
system prompt necessarily explains both answers, so parsing the whole reply could never
tell the contract's explanation from the answer. Total by construction — a crash, a hedge,
or silence all read as unresolved, which costs exactly one human glance.

**Stop sharing a resource; do not detect collisions.** A real run once issued
`tmux kill-session -t a` for a TASK named `a` and killed a human's unrelated session
`audan` — tmux falls back to a prefix match. A task name never has to collide exactly with
anything real, only be a prefix of it. Hence a dedicated tmux server per tool: the fix for
shared-resource hazards here is to stop sharing, not to detect.

**Teardown is not the executor's move, and the settle believes nobody's word.** The
executor's session lives inside the very worktree being removed, so it never tears down
its own house. The settle re-verifies both conditions itself — the state word reads
`mergeable`, and the branch is an ancestor of `main`, asked of git — whichever of its two
callers fires; a session that just did the merging is the least impartial judge of whether
the merge landed.

**Capacity is counted from the server, not from state words.** The live-session bound asks
the dedicated tmux server what it holds, fresh at every dispatch decision. A session is
alive through its whole start-to-`building` window and past `mergeable` while it still
merges, so counting state words would overshoot the bound in exactly those windows.

**Addressing across the worktree boundary is the starter's job, not an inference.** An
extension only ever gets `cwd`, and an executor's `cwd` is the worktree — not the checkout
the queue lives in; no path computed from `cwd` alone names the queue for every session.
So the session starter hands the queue root and task name down as environment variables,
and a tool that finds them absent refuses outright rather than guess from `cwd`.

**A builder is a poor judge of their own fresh work.** Review hands off to a reader who
never watched the code get written; those gates reliably catch a real class of defect —
overly weak tests, style and reuse drift — that a builder's own read does not. The same
rule split drafting from orchestration: the intent writer drafts prose, one pass per
spawn; the conversation holder orchestrates, owns the branch and the commits, and is never
its own pen. Personas own their own pipeline rules (`.pi/agents/*.md`); repo-level
instructions are not a second copy of them.

**The docket page owns no facts and no clock.** Each request re-runs the one-shot read, so
a page held open shows the docket as it stood at its last request. The page keeps no
clock: an age is a fact about a moment, not a number a browser should inflate. Commands
are shown as copyable text and never wired as controls — every action the queue can take
has a command, run where its failure is readable. `--host` defaults to the loopback,
because naming an interface is choosing who reads; and an address is an address, not a
mode — no arm of the code special-cases the all-interfaces spelling.

**The personas and the glue ship in the package, because the way to adopt the pipeline
is to copy it.** The nine personas and the two one-line extension glue files pack inside
the npm package — `.pi/agents/`, `.pi/extensions/`, and `src/` for the glue to resolve
into — and the README's from-zero guide walks an adopter through exactly that copy. The
glue re-exports `proofspec/src/...` by package name, not a relative path, so a copy
pasted into another project keeps resolving inside the installed package; in this repo
the same specifier resolves by self-reference. Shipping `src/` beside `dist/` is the
cost: the glue targets the entry this repo itself develops against, so the dev flow
never depends on a build.

## Where everything else lives

- What the tool does → `specs/*.md`, enforced by `pnpm spec:check`.
- The pipeline's vocabulary → `specs/glossary.md`.
- Personas and their scope → `.pi/agents/*.md`.
- The build pipeline's steps → the `ship` skill.
- How any of this got here → `git log`.
