# guard

Checks the tests against the committed capability files and fails the build when they
disagree.

This is what stops the tree from drifting. A spec that has gone wrong breaks the build,
so it gets fixed instead of rotting.

Two things the guard deliberately does not check, because they need judgement and a
person or an AI reading the co-located claim can supply it:

- whether every row of a parameterised table really reaches the same THEN;
- whether the scenarios sharing a test really share its action, rather than having been
  folded together to save an expensive setup.

### Requirement: A disagreement between the tests and the committed files fails the build

The guard SHALL rebuild the tree from the tests, compare it against the committed
capability files, and fail when the two differ.

The report SHALL name each difference: a scenario added, removed, renamed, or moved to
another file, under the capability and requirement it belongs to.

Line numbers take no part in the comparison. Inserting lines above a tagged test shifts
every position in the file and SHALL still compare clean.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Every tag names a requirement that exists

The guard SHALL fail when a `// Requirement:` tag names a requirement that no capability
file declares.

This catches a requirement renamed or deleted in the file while the tests went on
pointing at the old name.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Every declared requirement has something proving it

The guard SHALL fail when a requirement declared in a capability file has no scenario
tagged anywhere in the tests.

This catches a feature that was written and never proven. It is the direction that makes
the tree a coverage claim and not just an index.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A proof site the tree cannot hold fails the build

The guard SHALL fail when a tagged site sits in a file that declares no capability.

The site has no parent, so there is nowhere in the tree to put it. The scan reports it as
unresolved rather than as an error, and leaves the decision here.

A tagged site with no GIVEN, WHEN or THEN above it SHALL be reported as a warning. It is
co-location in name only: there is a tag, but no claim to judge the test against.

Anything else the scan could not read SHALL fail the build as well — an AND where a step
keyword belongs, a test using both tag placements at once, a file declaring two
capabilities. The scan reports what it found. Deciding that a build cannot proceed is
this capability's job.

A tag without its pair is not checked here. The skill that applies a change writes the
two tags together, so a lone tag is prevented where it would be written rather than
caught afterwards. One that appears anyway still fails the build, under another rule: it
yields no proof site, so its requirement reads as uncovered, or its scenario reads as
missing from the regenerated tree.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A scenario claimed by two proof sites fails the build

The guard SHALL fail when the same capability, requirement and scenario are tagged at
more than one proof site, and SHALL name every site that claimed it.

One scenario has one proof. Two proofs mean the action was not the same after all, and
the scenario needs splitting — or the two sites are the same claim written twice.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A capability is enforced once a test tags it

The guard SHALL apply the requirement rules to a capability only once at least one test
tags it.

A capability file that no test tags yet is planned, not built. The guard leaves its
requirements alone until the first test arrives, so a spec written ahead of its tests does
not fail the build. This is what OpenTDD's own workflow needs: the spec is authored first,
then the tests, then the code. Writing every test red before the code is what then holds
the capability whole — each red test still carries its tag, so no declared requirement
reads as uncovered just because its code is not written yet.

Tags naming a capability that has no file are the mirror case. The scan reports them as
unresolved, and the guard leaves them alone too, so an existing suite can adopt OpenTDD one
capability at a time instead of retagging everything before the build goes green.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A failure says what to do about it

Every failure SHALL name the capability, the requirement, the scenario, and the file and
line of the site that caused it.

A message that says only "the spec and the tests disagree" hands the reader the whole
search back. The point of putting a claim next to its proof is that the distance between
knowing something is wrong and seeing it is short, and a diagnostic that omits the
location throws that away.

<!-- scenarios: generated -->
<!-- /scenarios -->
