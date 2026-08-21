# impact

Answers what a change to the source code reaches.

`touched` reads a change to the tests and names the promises behind them. This asks the
question from the other end: a function was edited — what calls it, and which tests get
there? The call graph comes from outside; this capability only walks it.

### Requirement: A change is placed on the functions whose lines it fell in

Given the changed lines of the source files and a call graph, impact SHALL name the
functions those lines fall in, and SHALL report a changed file holding no function the
graph knows rather than dropping it.

A file with no function on the graph is an ordinary thing — an entry script whose code sits
at the top level, or a file the index has not seen. Saying so is the difference between "this
change reaches nothing" and "I could not place this change".

<!-- scenarios: generated -->
- "A changed file with no function the graph knows is reported unmapped" → tests/impact/tree.test.ts
- "A changed line inside a function puts that function on the tree" → tests/impact/tree.test.ts
<!-- /scenarios -->

### Requirement: Everything that reaches a changed function is on the tree

Impact SHALL walk the call graph backwards from each changed function and put every caller
on the tree, however many hops away it is.

A function SHALL be expanded once. A second appearance is reported as repeated, its callers
not walked again: the same subtree printed twice is noise, and a cycle in the graph would
otherwise never end. The walk SHALL stop at the depth it is given, because the far end of a
long chain is not what a reviewer is looking at.

<!-- scenarios: generated -->
- "A caller two hops away is reached through the caller between them" → tests/impact/tree.test.ts
- "A function already on the tree is not expanded a second time" → tests/impact/tree.test.ts
- "A function that calls a changed one is on the tree above it" → tests/impact/tree.test.ts
- "The walk stops at the depth it was given" → tests/impact/tree.test.ts
<!-- /scenarios -->

### Requirement: A test is named where it reaches the change

Impact SHALL name every test that calls a function on the tree, under the function it calls.

That is the whole point of the walk: the tests hanging off the tree are the ones to review,
and the promises they prove are the ones to re-read. A test is named under the function it
actually calls, not under the changed function, so a reader can see how far the change is
from the test — one hop is a direct proof, four hops is a test that merely passes through.

<!-- scenarios: generated -->
- "A test that calls a caller of the change is named under that caller" → tests/impact/tree.test.ts
- "A test that calls a changed function is named under it" → tests/impact/tree.test.ts
<!-- /scenarios -->

### Requirement: A test's own coverage is the counters that moved while it ran

Given a coverage counter snapshot from before a test and one from after, impact SHALL name
the functions whose counters went up, and no others.

Coverage counters are cumulative: by the tenth test they hold what the first nine did too.
Reading them straight would say every test runs everything. The difference between two
snapshots is what that one test ran, and it is the only thing that makes per-test attribution
mean anything.

<!-- scenarios: generated -->
- "A counter that went up while the test ran names a function it executed" → tests/impact/coverage.test.ts
- "A counter the test never moved is not named however high it stands" → tests/impact/coverage.test.ts
<!-- /scenarios -->

### Requirement: The tests that ran a changed function are named from coverage

Given what each test ran and the functions a change edited, impact SHALL name the tests that
ran one of them.

The call graph says a test file *can* reach the change; this says a test *did*. It is matched
on the function and the file it lives in together, because two files may each hold a function
of the same name and only one of them changed.

<!-- scenarios: generated -->
- "A function of the same name in another file is not a match" → tests/impact/coverage.test.ts
- "A test that ran a changed function is named" → tests/impact/coverage.test.ts
- "A test that ran only other functions is not named" → tests/impact/coverage.test.ts
<!-- /scenarios -->
