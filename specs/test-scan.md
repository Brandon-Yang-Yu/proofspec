# test-scan

Reads TypeScript test files and returns the list of proof sites. A proof site is one
place that claims to prove a scenario. For each one the scan reports its tags, its
Gherkin steps, and where it sits right now.

This is the only capability that knows TypeScript. Everything downstream reads the list
and nothing else.

### Requirement: A tag pair's layer decides the proof site

The scan SHALL decide what a proof site is from where its `// Requirement:` and
`// Scenario:` tags sit. Two placements, two meanings:

- **Above a test.** The whole test is one proof site.
- **Above a statement inside a test.** That statement opens a block. The block ends at
  the next tagged statement, or at the end of the test. Untagged statements belong to the
  block above them.

One test may not use both placements. A test that does is an error, because its proof
sites could be counted two ways.

What counts as a test: a call to `it` or `test`, including `.each`, `.skip`, `.only` and
`.concurrent`. A test nested in `describe` blocks is found however deep it goes. A
parameterised test is one proof site, however many rows its table has. An `it(...)`
written inside a string or a comment is not a test.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Gherkin steps are read exactly as written

The scan SHALL take a proof site's steps from the `//` comment lines directly above it.

- The step keywords are GIVEN, WHEN and THEN. AND is an error.
- A comment line starting with none of them continues the step above it. This is how a
  step runs to a second sentence.
- Only `//` comments are read. A `/* */` block is not a step.
- A comment counts only if it sits directly above the site, with no blank line between.
  So a comment about something else never becomes a claim about a test.

When a test holds several blocks, the GIVEN and WHEN above the test belong to all of
them. The author writes them once. The scan delivers them on every block.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A capability tag governs the file it heads

The scan SHALL attach a file's `// Capability:` tag to every proof site in that file.

A file may declare one capability at most. Two is an error: a proof site with two
possible parents has no place in the tree.

A proof site in a file with no capability tag is reported as unresolved. The scan says
what it found. `guard` decides whether that fails the build.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A file's proof sites depend on nothing but that file

Scanning a file SHALL give the same proof sites whatever state the rest of the project is
in. Types that do not check, imports naming modules that do not exist, no build
configuration at all — none of it changes the answer.

Why: the spec matters most in the middle of a refactor, which is exactly when the build
is least likely to be green. A scan that needed the project to compile would go blind
when it is needed most.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Every proof site reports its current position

The scan SHALL report the line of each proof site and the line of each of its steps.
`locate` needs them to answer where a scenario is. `guard` needs them to point at what
caused an error.

Positions SHALL be right in files containing non-ASCII text. A spec written in any
language is still a spec.

<!-- scenarios: generated -->
<!-- /scenarios -->
