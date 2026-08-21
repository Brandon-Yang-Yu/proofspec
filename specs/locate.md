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
- "A scenario's position is the file and line of its tagged test" → tests/locate/position.test.ts
- "The reported line follows the test when lines are inserted above it" → tests/locate/position.test.ts
<!-- /scenarios -->

### Requirement: A scenario that cannot be found is said to be missing

When no tagged test carries the scenario, locate SHALL say so and name what it looked for.

It SHALL NOT return the nearest match. A confident wrong location costs more than no
location: the reader goes to the wrong test and judges the wrong claim.

<!-- scenarios: generated -->
- "A near-miss title is not offered as the answer" → tests/locate/missing.test.ts
- "An absent scenario is reported missing, naming what was looked for" → tests/locate/missing.test.ts
<!-- /scenarios -->

### Requirement: The whole tree can be read at once

Locate SHALL deliver the entire tree — capability, requirement, scenario, and each
scenario's current file and line.

This is the view a person reads to see what the project promises, and the view an AI
reads before deciding whether a test does what its claim says. Both need the positions,
which is why the tree cannot simply be the committed files.

<!-- scenarios: generated -->
- "A scenario's file in the tree is its current file, not the tree's stored file" → tests/locate/tree.test.ts
- "A scenario's line in the tree is its current line" → tests/locate/tree.test.ts
- "Every scenario in the tree is delivered with its file and line" → tests/locate/tree.test.ts
<!-- /scenarios -->

### Requirement: The spec is rendered as one page per capability with an index

Locate SHALL render each capability as its own page and an index that links to them all,
each page carrying its requirements' descriptions and its scenarios' Gherkin and current
positions.

The committed files record only titles and locations, so on their own they show which
scenarios exist, not what they say. This render is the readable view the storage/delivery
split makes possible: the descriptions come from the files, the Gherkin and the positions
come live from the tests, and no second copy of behavior is stored. A capability is the unit
a reader browses, so it is the unit the render splits into pages, with an index as the one
entry point.

<!-- scenarios: generated -->
- "A capability is rendered as its own page" → tests/locate/render.test.ts
- "A recorded scenario with no proof is rendered as unproven" → tests/locate/render.test.ts
- "A requirement is rendered with its description" → tests/locate/render.test.ts
- "A scenario is rendered with its Gherkin steps" → tests/locate/render.test.ts
- "A scenario is rendered with its current position" → tests/locate/render.test.ts
- "The index links to every capability in name order" → tests/locate/render.test.ts
<!-- /scenarios -->

### Requirement: The whole spec is rendered as one page

Locate SHALL also render every capability into one page, each requirement and scenario
carrying the same description, Gherkin, and current position its capability's own page
shows.

A page per capability is the unit a reader browses. Reading the whole promise at once — or
handing the spec to a model that reads one file — wants a single page instead. Both views
come from the same render, so they cannot say different things. The full page spends its top
heading level on the capability, so its requirements and scenarios sit one level deeper, and
the index links to it, so the one entry point offers both ways in.

<!-- scenarios: generated -->
- "Every capability is rendered into one full-spec page" → tests/locate/render.test.ts
- "The full-spec page says everything the capability pages say" → tests/locate/render.test.ts
- "The index links to the full-spec page" → tests/locate/render.test.ts
<!-- /scenarios -->

### Requirement: Each proof is rendered as an anchored code snippet its scenario links to

Locate SHALL render each proof as a code snippet of its lines on the test's page, headed by
its scenario and carrying that scenario's Gherkin, and link every scenario to the snippet that
proves it.

A scenario's whole point is that its proof can be read against the claim, so the snippet holds
both: its scenario's Gherkin, then the proving lines, so a reader can judge whether the test
does what the claim says without leaving the page. Each snippet is headed by its scenario title,
and each scenario links to that heading's anchor, so the anchor reads as the scenario and the
reader lands on the proving code rather than the top of an undifferentiated file. Everything is
delivered from the tests each run, never stored, so it is not a second copy of behavior.

<!-- scenarios: generated -->
- "A proof is rendered as a code snippet" → tests/locate/render.test.ts
- "A scenario links to the snippet that proves it" → tests/locate/render.test.ts
- "A snippet is headed by its scenario" → tests/locate/render.test.ts
- "A snippet shows its scenario's Gherkin" → tests/locate/render.test.ts
<!-- /scenarios -->

### Requirement: The scenarios proven at a set of lines can be found

Given a file's proof sites and a set of its lines, locate SHALL name every scenario whose
proof those lines fall in, and report the lines that fall in none.

This is the inverse of asking where a scenario is: it asks what a change touched. A
scenario's claim sits *above* its code — the Gherkin comment block comes before the test —
so the span a line is matched against runs from the first step to the last line of the
proof. Matching only the test body would miss the one change that matters most: a rewritten
GIVEN/WHEN/THEN is the promise itself changing, so locate SHALL say which of the two a
change reached. Lines that fall in no proof are reported rather than dropped, because a
helper, an import, or a fixture is a real change with no promise behind it.

<!-- scenarios: generated -->
- "A line changed in the Gherkin above a proof says the claim changed" → tests/locate/touched.test.ts
- "A line changed inside a proof names the scenario it proves" → tests/locate/touched.test.ts
- "A line changed outside every proof is reported as matching none" → tests/locate/touched.test.ts
- "A proof with no capability names no scenario" → tests/locate/touched.test.ts
- "A scenario is named once however many changed lines fall in it" → tests/locate/touched.test.ts
<!-- /scenarios -->
