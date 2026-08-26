# guard

Checks the tests against every committed CAPABILITY FILE and fails the build when they
disagree.

This is what stops the tree from drifting. A spec that has gone wrong breaks the build,
so it gets fixed instead of rotting.

Two things the guard deliberately does not check, because they need judgement and a
person or an AI reading the co-located CLAIM can supply it:

- whether every row of a parameterised table really reaches the same THEN;
- whether the scenarios sharing a test really share its action, rather than having been
  folded together to save an expensive setup.

### Requirement: A disagreement between the tests and the committed CAPABILITY FILE fails the build

The guard SHALL rebuild the tree from the tests, compare it against the committed
CAPABILITY FILE, and fail when the two differ.

The report SHALL name each difference: a scenario added, removed, or moved to another
file, under the capability and requirement it belongs to.

A renamed scenario reads as one removed and one added. The title is the scenario's
identity, so a changed title is a different scenario, and no comparison of two trees can
tell a rename from one deletion and one unrelated addition.

Line numbers take no part in the comparison. Inserting lines above a tagged test shifts
every position in the file and SHALL still compare clean.

<!-- scenarios: generated -->
- "A scenario proven in another file fails the build" → tests/guard/drift.test.ts
- "A scenario the committed CAPABILITY FILE does not record fails the build" → tests/guard/drift.test.ts
- "A scenario the tests no longer prove fails the build" → tests/guard/drift.test.ts
- "A test that moved down its file compares clean" → tests/guard/drift.test.ts
- "Tests matching the committed CAPABILITY FILE pass" → tests/guard/drift.test.ts
<!-- /scenarios -->

### Requirement: Every tag names a requirement that exists

The guard SHALL fail when a `// Requirement:` tag names a requirement that no capability
file declares.

This catches a requirement renamed or deleted in the CAPABILITY FILE while the tests went
on pointing at the old name.

<!-- scenarios: generated -->
- "A tag naming a requirement its capability does not declare fails the build" → tests/guard/tags.test.ts
<!-- /scenarios -->

### Requirement: Every declared requirement has something proving it

The guard SHALL fail when a requirement declared in a capability file has no scenario
tagged anywhere in the tests.

This catches a feature that was written and never proven. It is the direction that makes
the tree a coverage claim and not just an index.

<!-- scenarios: generated -->
- "A declared requirement no test proves fails the build" → tests/guard/coverage.test.ts
<!-- /scenarios -->

### Requirement: A PROOF SITE the tree cannot hold fails the build

The guard SHALL fail when a tagged site sits in a file that declares no capability.

The site has no parent, so there is nowhere in the tree to put it. The scan reports it as
unresolved rather than as an error, and leaves the decision here.

A tagged site with no GIVEN, WHEN or THEN above it SHALL be reported as a warning. It is
co-location in name only: there is a tag, but no CLAIM to judge the test against.

Anything else the scan could not read SHALL fail the build as well — an AND where a step
keyword belongs, a test using both tag placements at once, a file declaring two
capabilities. The scan reports what it found. Deciding that a build cannot proceed is
this capability's job.

A tag without its pair is not checked here. The skill that applies a change writes the
two tags together, so a lone tag is prevented where it would be written rather than
caught afterwards. One that appears anyway still fails the build, under another rule: it
yields no PROOF SITE, so its requirement reads as uncovered, or its scenario reads as
missing from the regenerated tree.

<!-- scenarios: generated -->
- "A tagged site in a file that declares no capability fails the build" → tests/guard/unreadable.test.ts
- "A tagged site with no Gherkin steps is a warning" → tests/guard/unreadable.test.ts
- "Anything the scan could not read fails the build" → tests/guard/unreadable.test.ts
<!-- /scenarios -->

### Requirement: A scenario claimed by two PROOF SITE fails the build

The guard SHALL fail when the same capability, requirement and scenario are tagged at
more than one PROOF SITE, and SHALL name every site that claimed it.

One scenario has one PROOF. Two PROOF mean the action was not the same after all, and
the scenario needs splitting — or the two sites are the same claim written twice.

<!-- scenarios: generated -->
- "The same scenario at two PROOF SITE fails the build" → tests/guard/collision.test.ts
<!-- /scenarios -->

### Requirement: A requirement declared twice is a warning

The guard SHALL report a warning, without failing the build, when a committed CAPABILITY
FILE declares the same requirement more than once, naming the capability and the
requirement.

The entries are recorded under both headings, deterministically, and nothing downstream
reads them wrong: the tree keys a scenario by its title under its requirement, so identical
entries under a repeated heading collapse to one. Stopping the build would punish a state
the tool already handles.

But two headings of one name are almost always an editing slip, and which one is meant to
survive is the author's call, not the tool's. So the guard says what it sees and leaves the
fix to the person or the AI reading the report — the same reason a site with no Gherkin
above it warns rather than fails.

<!-- scenarios: generated -->
- "A requirement declared twice in a committed CAPABILITY FILE is a warning" → tests/guard/duplicate-requirement.test.ts
<!-- /scenarios -->

### Requirement: A capability is enforced once a test tags it

The guard SHALL apply the requirement rules to a capability only once at least one test
tags it.

A CAPABILITY FILE that no test tags yet is planned, not built. The guard leaves its
requirements alone until the first test arrives, so a spec written ahead of its tests does
not fail the build. This is what ProofSpec's own workflow needs: the spec is authored first,
then the tests, then the code. Writing every test red before the code is what then holds
the capability whole — each red test still carries its tag, so no declared requirement
reads as uncovered just because its code is not written yet.

Tags naming a capability that has no CAPABILITY FILE are the mirror case. The scan reports them as
unresolved, and the guard applies neither requirement rule to them and leaves them out of
its comparison, so an existing suite can adopt ProofSpec one capability at a time instead of
retagging everything before the build goes green.

What still applies to them is what the tags say on their own. A scenario claimed at two
PROOF SITE fails wherever it is tagged, because a broken bijection is a fault in the tests
themselves and not a claim about a CAPABILITY FILE.

<!-- scenarios: generated -->
- "A CAPABILITY FILE no test tags yet does not fail the build" → tests/guard/enforcement.test.ts
- "A tag naming a capability with no CAPABILITY FILE does not fail the build" → tests/guard/enforcement.test.ts
<!-- /scenarios -->

### Requirement: A failure says what to do about it

Every failure SHALL name what it is about and where to look: the capability, the
requirement and the scenario it concerns, and the file and line of the PROOF SITE that
caused it.

A message that says only "the spec and the tests disagree" hands the reader the whole
search back. The point of putting a CLAIM next to its PROOF is that the distance between
knowing something is wrong and seeing it is short, and a diagnostic that omits the
location throws that away.

Some failures have no PROOF SITE to name, and they SHALL name what they do have. A
requirement nothing proves has no site by definition. A scenario the tests no longer prove
has none either, so it names the file it was recorded against. Something the scan could
not read is known by its position and by what the scan said about it.

<!-- scenarios: generated -->
- "A failure caused by a PROOF SITE names the site" → tests/guard/diagnostics.test.ts
- "A failure with no PROOF SITE names what it is about" → tests/guard/diagnostics.test.ts
<!-- /scenarios -->

### Requirement: Two runs over the same tests report the same findings

The findings SHALL come in a fixed order, whatever order the tests were scanned in and
whatever order a CAPABILITY FILE declares its requirements.

A report whose order changes from run to run cannot be diffed, so a reader who has already
seen it has to read it again from the top to find what is new. The order is the tool's to
choose, not the file walk's — and not the author's either: a CAPABILITY FILE's requirements
arrive in the order they were written, so the report has to put them in order itself.

<!-- scenarios: generated -->
- "Findings come in a fixed order whatever order a file declares its requirements" → tests/guard/order.test.ts
- "Findings come in a fixed order whatever order the tests were scanned" → tests/guard/order.test.ts
<!-- /scenarios -->

### Requirement: A TERM defines; it never promises

The guard SHALL fail when a Term section's definition contains a promise written as SHALL.

A definition holding a promise is a requirement in disguise: no scenario proves it, nothing
can drift against it, and no gate can see it move. A term says what a word means — the
promise it smuggles in belongs under a requirement, where the tests can hold it to account.

<!-- scenarios: generated -->
- "A Term section that only defines passes the guard" → tests/guard/terms.test.ts
- "A Term section that promises fails the build" → tests/guard/terms.test.ts
<!-- /scenarios -->

### Requirement: A TERM is written the way it is used

The guard SHALL fail when a TERM's name is not written in capitals, and when two Term
sections define the same TERM.

The name is the match key: a PROMISE uses a TERM by writing it in the exact form it was
defined in, so a name in lower case is a word no requirement can ever use, and it fails
rather than warns because a silent TERM is a missing one. Two definitions under one name
leave "the definition" not existing. A duplicate TERM fails where a duplicate requirement
only warns, because a requirement declared twice still has one set of scenarios to prove
it, while a word with two meanings has no meaning to use.

<!-- scenarios: generated -->
- "A Term heading not written in capitals fails the build" → tests/guard/terms.test.ts
- "Two Term sections defining the same TERM fail the build" → tests/guard/terms.test.ts
<!-- /scenarios -->
