# spec-tree

Turns the proof-site list into the stable tree — capability → requirement → scenario
title → file — and compares two trees.

This is the only place the stable-identity rule lands. Both `guard` and the capability
file write-back read the tree from here instead of building their own. Two builders would
drift, and the tree is what the whole tool rests on.

### Requirement: The tree is the stable projection of a scan

The tree SHALL hold one thing per scenario: its title and the file that proves it, under
its requirement, under its capability.

Nothing else goes in. No line numbers, no columns, no Gherkin text. Line numbers move
whenever anyone edits a test. Gherkin lives above its proof site and is not copied. What
is left is exactly what changes when the spec changes: a scenario added, removed,
renamed, or moved to another file.

The same scan SHALL always give the same tree, with entries in a fixed order. A file
regenerated on another machine is then byte-for-byte identical, so a comparison never
reports a difference that is only a difference in order.

When one scenario is proven in more than one file — a collision — the tree still lists it
under a single file, chosen the same way every build. So a collision, which the next
requirement reports, does not also make the tree itself unstable.

<!-- scenarios: generated -->
- "A collided scenario resolves to the same file whatever order its sites were scanned" → tests/spec-tree/projection.test.ts
- "A scenario keeps its title and file, not its steps or line" → tests/spec-tree/projection.test.ts
- "A test moving down its file does not change the tree" → tests/spec-tree/projection.test.ts
- "Sites are grouped under their capability and then their requirement" → tests/spec-tree/projection.test.ts
- "Sites scanned in any order yield the same tree" → tests/spec-tree/projection.test.ts
<!-- /scenarios -->

### Requirement: The tree counts one entry per scenario and reports collisions

Each `(capability, requirement, scenario)` SHALL appear once.

When two proof sites claim the same one, the tree SHALL carry the collision and name
every site that claimed it. It SHALL NOT keep one and drop the other. A broken bijection
is a modelling error the author has to see, and a tree that quietly deduplicated would
hide it.

A parameterised test adds one entry, matching the one proof site the scan reported for
it.

The collisions themselves SHALL come in a fixed order, so the report a build produces is
reproducible whatever order the scan walked the files.

<!-- scenarios: generated -->
- "Collisions are reported in a fixed order whatever the scan order" → tests/spec-tree/collision.test.ts
- "The same scenario at two proof sites is reported, naming both" → tests/spec-tree/collision.test.ts
- "The same title under a different requirement is not a collision" → tests/spec-tree/collision.test.ts
<!-- /scenarios -->

### Requirement: A proof site with no capability is set aside

A proof site with no `// Capability:` tag has no place under any capability, so the tree
SHALL set it aside rather than drop it.

The scan reports such a site with no capability; the tree cannot key it. Setting it aside
keeps it in view: `guard` reads the set-aside list and fails the build, instead of a
proof site vanishing without a word.

<!-- scenarios: generated -->
- "A site with no capability is set aside, not placed in the tree" → tests/spec-tree/unplaced.test.ts
<!-- /scenarios -->

### Requirement: Two trees are compared by meaning

Comparing a regenerated tree against a committed one SHALL say, for each difference,
whether a scenario was added, removed, or moved to a different file, and name the
capability and requirement it sits under.

A renamed scenario reads as one removed and one added, because the title is the
scenario's identity: change the title and it is a different scenario, not the same one
under a new name. So the comparison has three kinds of difference to report, not four.

Order is not a difference. Anything the tree does not hold is not a difference either, so
editing a test without changing what it claims compares clean.

The differences it reports SHALL come in a fixed order, so two runs on the same pair of
trees produce the same list.

`guard` turns this classification into the message a reader acts on. "These two files
differ" is not something a reader can act on.

<!-- scenarios: generated -->
- "A scenario in a different file is reported as moved" → tests/spec-tree/diff.test.ts
- "A scenario missing from the regenerated tree is reported as removed" → tests/spec-tree/diff.test.ts
- "A scenario only in the regenerated tree is reported as added" → tests/spec-tree/diff.test.ts
- "Differences are reported in a fixed order" → tests/spec-tree/diff.test.ts
- "Two matching trees compare clean" → tests/spec-tree/diff.test.ts
<!-- /scenarios -->
