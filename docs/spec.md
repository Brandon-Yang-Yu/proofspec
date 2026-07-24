# opentdd

## Purpose

OpenTDD makes the test suite the living spec. Each behavior is written as Gherkin — plain
English in GIVEN/WHEN/THEN steps — directly above the one test that proves it, and a
small tool reads those tests to build the tree `capability → requirement → scenario →
test`. That
tree *is* the project's spec: it cannot drift, because it is generated from the tests and
the build fails when the two disagree. The point is judgement — when the behavior claim
sits next to the test, a person or an AI can decide "does this test actually do what the
claim says?" without leaving the file.

## Philosophy

A test is the best description of software behavior we have — it is the one description
that is executable, so it cannot lie about what the software actually does. TDD grew out
of exactly this idea: state the behavior you want as a test first, then make it true.

Today AI is accelerating software development at a furious pace — code is written faster
than any person can read it. So we need a better way to *understand* the software we are
producing: a description that stays honest while the code churns underneath it. The
answer is not to write more prose that drifts, but to make the honest description — the
test — also the one a human can read.

OpenTDD's idea is a hybrid of TDD and Spec-Driven Development (SDD). From SDD it takes
the **scenario**: a unit of behavior stated in plain English and, written as Gherkin,
equally clear to a human and to an AI. From TDD it takes the **binding**: a scenario is
not a document sitting beside the code — it is fused to the one test that proves it, so
the spec and the code cannot drift apart.

That fusion changes who does what. With AI we can express the spec we want *as tests*, so
the tests — not prose — constrain how the software behaves. The human's job shrinks to
the one thing only a human can do: **confirm that the spec is what they actually want.**
The AI builds the bridge between spec and test, and then writes the software to satisfy
the test. Intent is the human's; the translation from intent to test, and from test to
code, is the AI's; and the test is the contract that keeps all three honest.

And this is the deeper reason the design is shaped the way it is: **making alignment
cheap is close to the whole of how you get the most out of an AI.** The scarce resource
is not the model's intelligence — it is its attention. And there is a division of labour
in that: **building the attention — the raw intelligence — is the model provider's job;
making the most of that attention is the job of everyone building on top.** An
application takes the model as given and competes on one thing — how well it lays out the
context it feeds in. Every token the model reads should carry accurate, useful signal,
and every token spent reconstructing context that a better layout would have made obvious
is wasted. OpenTDD lives entirely on that second side. It does not promise a machine can
prove the claim and the code mean the same thing — no build step can. What it promises is
to put the claim and its proof in one place, so the one judgement that matters — *does
this test do what it says?* — costs an AI almost nothing to make. Cheap alignment is not
a convenience; it is how the whole arrangement pays off.

This is also why the approach does not age against the model. A tool that fills a gap in
today's model — "it can't yet do X, so we do X" — is a **pillar**: the next model does X
and walks straight through it. A tool that only makes the context better is a **boat**:
as the model's attention grows more capable and more precious, laying it out well matters
*more*, not less. OpenTDD is a boat. It never competes with the model — only on how
cheaply it can align intent, test, and code, and that is worth more with every model, not
less.

## Requirements

### Requirement: A scenario is identified by its action and its outcome

A scenario's identity SHALL be `(GIVEN, WHEN) + one THEN`. Two claims that observe the
same outcome after the same action are the same scenario; two claims that differ in
either the action or the outcome are different scenarios. This is what fixes the grain of
the whole tree, so every other requirement here rests on it: without it "one scenario"
has no meaning and the bijection has nothing to count. A different layer (api / component
/ e2e) is therefore a different scenario not because the layer differs but because the
action does — calling a function and sending a request are not the same WHEN.

Two consequences follow, and are stated here rather than left to be rediscovered. Inputs
that differ only in data — the same action, the same THEN — SHALL be one scenario,
carried as a table of rows on a single parameterised test, which counts as one test;
every row SHALL reach the same THEN, and a row that reaches a different outcome is a
second scenario wearing a table row's clothes. And a scenario SHALL have exactly one
THEN: a second outcome is a second scenario, which is why AND is not among the permitted
step keywords — it is the one keyword that lets a second outcome in unnoticed.

Because scenarios are identified by outcome, the tree partitions *outcomes*, not
*actions*. One action MAY therefore appear under several requirements — that is the tree
being shaped correctly, not a violation.

#### Scenario: The same action with a different outcome is a different scenario

- **WHEN** two claims share an action but observe different outcomes
- **THEN** they are two scenarios, each with its own THEN and its own proof

#### Scenario: Rows that differ only in data stay one scenario

- **WHEN** the same action is exercised with several inputs that all reach the same THEN
- **THEN** they are one scenario, written once above a single parameterised test whose
  table carries the rows, and the tool counts that parameterised test as one test

### Requirement: Behavior lives as Gherkin where it is proven

The behavior of each scenario SHALL be written as Gherkin — plain English in
GIVEN/WHEN/THEN steps — at the place that proves it. Where a whole test proves one
scenario, every step SHALL sit on the lines directly above that test. Where one action
proves several scenarios, the shared GIVEN/WHEN SHALL sit above the test and each
scenario's THEN SHALL sit directly above the assertion that checks it, so no claim is
ever separated from its proof. Of Gherkin's step keywords only GIVEN, WHEN, and THEN
SHALL be used; AND SHALL NOT, for two reasons. A step's text MAY run to more than one
sentence when one is not enough to state the condition or the outcome precisely, which is
what a continuation keyword would otherwise be for. And, more importantly, an AND under a
THEN admits a second outcome — which by the identity rule above is a second scenario, so
the keyword would quietly break the very thing that defines a scenario. Where the removed
AND leaves a claim that one block of assertions can prove, it belongs in the same THEN as
another sentence; where it does not, it was a second scenario all along. The behavior
text SHALL NOT be copied into
any other file: a high-level requirement MAY be stated on its own, but a scenario's
GIVEN/WHEN/THEN SHALL live only with its proof. Reading a test therefore means reading
its claim and its code together.

#### Scenario: A scenario is written above its test

- **WHEN** someone opens a test file
- **THEN** each test has its expected behavior written directly above it as Gherkin,
  plain English in GIVEN/WHEN/THEN steps

#### Scenario: A shared action puts each THEN with its own assertion

- **WHEN** one action proves more than one scenario, so a single test carries them all
- **THEN** the shared GIVEN/WHEN sits above the test and each scenario's THEN sits
  directly above the assertion that checks it

#### Scenario: A step is introduced by GIVEN, WHEN, or THEN only

- **WHEN** a scenario's behavior is written above its test
- **THEN** every step begins with GIVEN, WHEN, or THEN, no AND appears, and a step that
  needs more than one sentence simply runs on

#### Scenario: Behavior is not duplicated outside the test

- **WHEN** a scenario's behavior is recorded
- **THEN** the GIVEN/WHEN/THEN text appears only above its test, and no separate spec
  file keeps a second copy

### Requirement: A scenario has exactly one proof site

A scenario SHALL be proven in exactly one place, and each place SHALL prove exactly one
scenario — a bijection between scenarios and proof sites. A proof site is a whole test
when that test proves one scenario, or one block of assertions inside a test when several
scenarios share that test's GIVEN/WHEN. The same `(capability, requirement, scenario)`
claimed by two proof sites SHALL be reported as an error.

Sharing a test is permitted only for a shared action, never for shared convenience: the
scenarios in one test SHALL have the same GIVEN and the same WHEN, differing only in
their THEN. Two scenarios with different actions SHALL NOT be folded into one test to
save its setup.

#### Scenario: A scenario maps to a single proof site

- **WHEN** a scenario is added
- **THEN** exactly one proof site proves it, and no other proof site claims the same
  `(capability, requirement, scenario)`

#### Scenario: The same scenario claimed by two proof sites is rejected

- **WHEN** two proof sites tag the same `(capability, requirement, scenario)`
- **THEN** the guard fails, reporting the bijection as broken

#### Scenario: One test may hold several scenarios that share its action

- **WHEN** one action produces several observable outcomes that belong to different
  requirements
- **THEN** one test carries them all, each outcome tagged and asserted at its own proof
  site, and the bijection holds because each scenario still has exactly one

### Requirement: A requirement records where its scenarios are, not their behavior

Each capability SHALL be recorded as a committed Markdown file holding, per requirement,
its authored description and a generated list of that requirement's scenarios as
`title → file` — the scenario's location, not its steps. The description is authored by a
human; the scenario list is generated by the tool from the tests. The file SHALL NOT
store any scenario's GIVEN/WHEN/THEN text, since that lives only above the test.

#### Scenario: The capability file lists scenario title and file, not behavior

- **WHEN** the tool writes a capability file
- **THEN** each requirement shows its authored description and a generated block of
  `scenario title → file` entries, and no GIVEN/WHEN/THEN text

### Requirement: A scenario's current location is delivered, never stored

Line numbers SHALL NOT be stored in the committed files. On request the tool SHALL
resolve a scenario's current `file:line` by finding its title in the tagged test and
reporting the line as it stands. Because the location is computed on demand, editing a
test — inserting lines above a scenario — SHALL NOT produce a drift.

#### Scenario: The current line is resolved on demand

- **WHEN** someone asks the tool where a scenario is
- **THEN** it finds the scenario title in its tagged test and reports the current
  `file:line`, which was never committed

#### Scenario: Editing a test above a scenario does not create drift

- **WHEN** lines are inserted above a tagged test, shifting its line number
- **THEN** the guard still passes, because line numbers are not part of the committed
  tree

### Requirement: The guard fails the build on drift

The tool SHALL rebuild the stable tree (`capability → requirement → scenario title →
file`) from the tests and compare it against the committed capability files, failing the
build when they disagree. The comparison SHALL exclude line numbers. The guard SHALL
fail when: a committed file is stale (regenerated tree ≠ committed), a tagged
`// Requirement:` has no matching `### Requirement:` heading, a declared requirement has
no scenario in any test, a `// Requirement:` or `// Scenario:` tag is present without its
pair, or a test carries Requirement/Scenario tags with no `// Capability:`. Where one
test holds several scenarios, each proof site inside it SHALL be checked as its own
entry, and a scenario tagged at two proof sites SHALL fail the build.

#### Scenario: A stale capability file fails the build

- **WHEN** the tree regenerated from the tests differs from the committed capability file
- **THEN** the guard fails and reports the difference

#### Scenario: A requirement with no scenario fails the build

- **WHEN** a declared requirement has no scenario tagged in any test
- **THEN** the guard fails, reporting the requirement as uncovered

#### Scenario: A tag without its pair fails the build

- **WHEN** a test carries a `// Requirement:` without a `// Scenario:` (or the reverse),
  or Requirement/Scenario tags with no `// Capability:`
- **THEN** the guard fails, reporting the tag as incomplete
