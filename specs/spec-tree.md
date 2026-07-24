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

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: The tree counts one entry per scenario and reports collisions

Each `(capability, requirement, scenario)` SHALL appear once.

When two proof sites claim the same one, the tree SHALL carry the collision and name
every site that claimed it. It SHALL NOT keep one and drop the other. A broken bijection
is a modelling error the author has to see, and a tree that quietly deduplicated would
hide it.

A parameterised test adds one entry, matching the one proof site the scan reported for
it.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Two trees are compared by meaning

Comparing a regenerated tree against a committed one SHALL say, for each difference,
whether a scenario was added, removed, renamed, or moved to a different file, and name
the capability and requirement it sits under.

Order is not a difference. Anything the tree does not hold is not a difference either, so
editing a test without changing what it claims compares clean.

`guard` turns this classification into the message a reader acts on. "These two files
differ" is not something a reader can act on.

<!-- scenarios: generated -->
<!-- /scenarios -->
