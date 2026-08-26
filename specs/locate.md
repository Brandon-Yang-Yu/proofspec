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

### Requirement: The vocabulary is rendered as one page, linked from the index

Locate SHALL render every term on one vocabulary page in name order with its definition,
link that page from the index, and carry the vocabulary on the whole-spec page.

A spec with defined terms is read half in its requirements and half in its vocabulary: the
requirement says what the tool SHALL do, the term says what the words in that sentence mean.
A reader sent from an index straight into a requirement that uses TURN has to know where TURN
is defined, and one page of vocabulary in name order is that place.

A spec that defines no terms SHALL render no vocabulary page and link none. A repository
with no glossary is rendered exactly as it was before glossaries existed.

<!-- scenarios: generated -->
- "The index links the vocabulary page" → tests/locate/render-vocabulary.test.ts
- "The vocabulary page holds every term in name order" → tests/locate/render-vocabulary.test.ts
- "The whole-spec page carries the vocabulary" → tests/locate/render-vocabulary.test.ts
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

Given a file's proof sites and a set of its lines, locate SHALL name every scenario those
lines reached, SHALL say for each whether the change moved its claim, its proof, or both,
SHALL carry each scenario's claim in full together with the lines that prove it, and SHALL
report the lines that reached none.

This is the inverse of asking where a scenario is: it asks what a change touched. A proof
has two halves — the claim sits *above* the code, since the Gherkin comment block comes
before the test, and the proof is the code below it. Matching only the test body would miss
the change that matters most: a rewritten GIVEN/WHEN/THEN is the promise itself changing.

The three answers are three different situations, which is why `both` is an answer of its
own and not two flags read together. A moved proof under an unmoved claim is a promise that
may no longer describe what its test does. A moved claim over an unmoved proof is a promise
restated with the same evidence behind it. Both moved is an author who already brought the
two along together, leaving only the question of whether they still agree.

Which lines a scenario owns SHALL follow the layer its tag sits at. A site tagging its whole
test owns its tag block and its body. A site tagging a statement inside a body shares a
prelude with the other scenarios in that test, and shares it in both directions: the
GIVEN/WHEN above the test is part of every sentence written under it, so a change there
moves every one of their claims, and the setup between the test's first line and the first
block is part of how every one of them is proven, so a change there moves every one of their
proofs. What a block writes between its own tag and the next one is nobody else's, so a
change there SHALL name that block alone. Lines that fall in no proof are reported rather
than dropped, because a helper, an import, or a fixture is a real change with no promise
behind it.

The answer carries the claim and names the proving lines rather than pointing at them,
because the question this report exists to raise — does the test still do what its claim
says — cannot be asked without both in hand. A scenario proven inside a shared test is
proven by more than one run of lines: the setup its test shares, and its own statements.
A sibling's lines SHALL NOT be among them, since evidence for another scenario is the wrong
thing to judge this one by. Lines rather than source, because locate reads no files.

<!-- scenarios: generated -->
- "A block reports the line its own tag opens on, not the prelude it shares" → tests/locate/touched.test.ts
- "A change in one block's own Gherkin names that block alone" → tests/locate/touched.test.ts
- "A change in one block's own code says its proof changed" → tests/locate/touched.test.ts
- "A change in the Gherkin alone says the claim changed" → tests/locate/touched.test.ts
- "A change in the test body alone says the proof changed" → tests/locate/touched.test.ts
- "A change reaching both halves of one block says both changed" → tests/locate/touched.test.ts
- "A change reaching both shared halves changes both for every scenario in the test" → tests/locate/touched.test.ts
- "A change reaching the Gherkin and the body says both changed" → tests/locate/touched.test.ts
- "A change to the line a scenario is named on says the claim changed" → tests/locate/touched.test.ts
- "A line changed outside every proof is reported as matching none" → tests/locate/touched.test.ts
- "A line that reached a proof is not also reported as matching none" → tests/locate/touched.test.ts
- "A proof with no capability names no scenario" → tests/locate/touched.test.ts
- "A scenario is named once however many changed lines fall in it" → tests/locate/touched.test.ts
- "A shared step is claim down to the line the test opens on" → tests/locate/touched.test.ts
- "A step shared above the blocks changes the claim of every scenario in the test" → tests/locate/touched.test.ts
- "A touched scenario carries the Gherkin it claims" → tests/locate/touched.test.ts
- "A touched scenario names the lines that prove it" → tests/locate/touched.test.ts
- "Every part of a changed run that no proof owns is reported" → tests/locate/touched.test.ts
- "Setup shared above the blocks changes the proof of every scenario in the test" → tests/locate/touched.test.ts
- "The line between two blocks belongs to the block above it" → tests/locate/touched.test.ts
<!-- /scenarios -->
