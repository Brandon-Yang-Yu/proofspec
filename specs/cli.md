# cli

The commands people and CI actually run.

Everything else in this tool is a library. This is where it becomes something you can put
in a build.

### Requirement: Checking never writes

The command that checks SHALL NOT modify any file.

A check that quietly fixed what it found would report success on a repo that was wrong
until the moment it ran. The build would go green and the committed files would go on
disagreeing with what was reviewed.

Writing back is a separate command, run on purpose.

<!-- scenarios: generated -->
- "A check that finds drift changes no file on disk" → tests/cli/no-write.test.ts
<!-- /scenarios -->

### Requirement: The exit code says what happened

The check SHALL exit zero when the tests and the committed files agree, and non-zero when
they do not.

A tool that cannot be configured or cannot read its inputs SHALL exit with a different
non-zero code than a spec that has drifted. CI needs to tell "your spec is wrong" apart
from "I could not run".

<!-- scenarios: generated -->
- "A repo the check cannot run in exits with a code that is not the drift code" → tests/cli/exit-code.test.ts
- "Agreement between the tests and the committed files exits zero" → tests/cli/exit-code.test.ts
- "Drift between the tests and the committed files exits non-zero" → tests/cli/exit-code.test.ts
<!-- /scenarios -->

### Requirement: It runs in a conventional repo with no configuration

Running the check in a repo that keeps its capability files and its tests in the usual
places SHALL work with no configuration file present.

Both locations SHALL be configurable for repos that do it differently. Nothing else needs
setting: there is no compiler to point at and no project to build.

<!-- scenarios: generated -->
- "Both locations can be pointed at where a repo keeps them" → tests/cli/locations.test.ts
- "Locations given as absolute paths are read from exactly there" → tests/cli/locations.test.ts
- "The conventional layout is checked with no locations given" → tests/cli/locations.test.ts
<!-- /scenarios -->

### Requirement: Any answer can be given in a form a program can read

Every command SHALL be able to return its answer as JSON, carrying the same content as
the form written for a person.

The tree, the positions, and the failures are all things another tool will want — an
editor, a CI annotation, and in a later version an MCP server. Each of those should read
the same answer rather than parse the one meant for a terminal.

<!-- scenarios: generated -->
- "The check's verdict is returned as JSON carrying the same findings" → tests/cli/json.test.ts
- "The write's answer is returned as JSON naming the changed files" → tests/cli/json.test.ts
<!-- /scenarios -->

### Requirement: Writing back records the tests in the committed files

The write command SHALL update each committed capability file so its recorded scenarios
match the tests, and change nothing else.

This is the separate command requirement 1 keeps apart from the check. It is run on
purpose, and it is what finally writes the generated blocks the tool has until now had
filled by hand.

It touches only the generated blocks. Headings, descriptions, and every other line come
back exactly as they were, and a file already in agreement with its tests comes back byte
for byte the same.

If a test cannot be read, the write SHALL change nothing and say so. It records what the
tests prove, so a test the scan could not read is a tree it cannot trust. Unlike the check,
the write changes files, so it refuses before it acts rather than reporting after.

<!-- scenarios: generated -->
- "Writing back a repo already in agreement changes no file" → tests/cli/write.test.ts
- "Writing back a repo it cannot fully read changes nothing" → tests/cli/write.test.ts
- "Writing back leaves the other capability files untouched" → tests/cli/write.test.ts
- "Writing back records a scenario the tests prove but the file did not" → tests/cli/write.test.ts
- "Writing back through an absolute location changes the file exactly there" → tests/cli/write.test.ts
<!-- /scenarios -->

### Requirement: A command renders the spec into an output directory

The CLI SHALL provide a render command that writes the rendered pages into a directory and
reports the files it wrote.

The pages are a delivery artifact, not an input: they are regenerated from the tests on
demand and read by a person, never read back by the tool. The command writes an index and
one page per capability; given no directory it writes them under `build/`, and a directory can
be given for a repo that keeps the generated pages elsewhere. The pages are a generated output,
so a project gitignores that directory rather than committing it. Inputs it cannot read are
refused the way the check and the write refuse them.

<!-- scenarios: generated -->
- "An absolute output directory is written to exactly" → tests/cli/render.test.ts
- "The render command reports it cannot run on unreadable inputs" → tests/cli/render.test.ts
- "The render command writes into a chosen directory" → tests/cli/render.test.ts
- "The render command writes to the default directory when none is given" → tests/cli/render.test.ts
<!-- /scenarios -->
