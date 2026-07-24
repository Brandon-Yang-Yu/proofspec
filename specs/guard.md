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

### Requirement: An incomplete tag fails the build

The guard SHALL fail when a proof site carries a `// Requirement:` without a
`// Scenario:`, or a `// Scenario:` without a `// Requirement:`, or when tagged sites sit
in a file that declares no capability.

Half a tag is not a smaller claim. It is a claim that cannot be placed in the tree.

A tagged site with no GIVEN, WHEN or THEN above it SHALL be reported as a warning. It is
co-location in name only: there is a tag, but no claim to judge the test against.

Anything else the scan could not read SHALL fail the build as well — an AND where a step
keyword belongs, a test using both tag placements at once, a file declaring two
capabilities. The scan reports what it found. Deciding that a build cannot proceed is
this capability's job.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A scenario claimed by two proof sites fails the build

The guard SHALL fail when the same capability, requirement and scenario are tagged at
more than one proof site, and SHALL name every site that claimed it.

One scenario has one proof. Two proofs mean the action was not the same after all, and
the scenario needs splitting — or the two sites are the same claim written twice.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A capability is enforced by having a file

The guard SHALL apply the requirement rules only to capabilities that have a committed
file.

Tests tagged with a capability nobody has written a file for are left alone. An existing
suite can therefore adopt OpenTDD one capability at a time, instead of having to retag
everything before the build goes green again.

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
