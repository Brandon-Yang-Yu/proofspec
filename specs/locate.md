# locate

Answers where a scenario is, right now, by looking at the tests.

This is the delivery half of the split the design record makes. The committed files hold
what is stable. Positions move on every edit, so they are computed when asked and never
written down.

### Requirement: A position is read from the tests as they stand

Asked where a scenario is, locate SHALL find its title in the tagged test and report the
file and line as they are at that moment.

Inserting lines above a tagged test changes the answer immediately. Nothing is
regenerated, nothing goes stale, and no file needs committing for the answer to be right.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A scenario that cannot be found is said to be missing

When no tagged test carries the scenario, locate SHALL say so and name what it looked for.

It SHALL NOT return the nearest match. A confident wrong location costs more than no
location: the reader goes to the wrong test and judges the wrong claim.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: The whole tree can be read at once

Locate SHALL deliver the entire tree — capability, requirement, scenario, and each
scenario's current file and line.

This is the view a person reads to see what the project promises, and the view an AI
reads before deciding whether a test does what its claim says. Both need the positions,
which is why the tree cannot simply be the committed files.

<!-- scenarios: generated -->
<!-- /scenarios -->
