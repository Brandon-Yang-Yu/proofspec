# spec-file

Reads and writes the committed capability files — the `.md` files that hold the tree.
Each one holds, per requirement, a description written by a person and a list of scenario
locations written by the tool.

The two halves have different owners, and this capability is what keeps them apart. It
knows the file format and nothing about the tree; `spec-tree` knows the tree and nothing
about files.

### Requirement: Reading a file yields its requirements and what they record

Reading a capability file SHALL give back each `### Requirement:` heading, the
description written beneath it, and the scenario entries recorded for it.

A heading inside a fenced code block is not a heading. A capability file that shows an
example of itself must not be read as if the example were real.

A requirement with no recorded entries reads as a requirement with none. That is an
ordinary state, not an error. It is what a requirement looks like before anything proves
it.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Writing back touches only the generated block

The write-back SHALL replace the content between `<!-- scenarios: generated -->` and
`<!-- /scenarios -->`, and change nothing else in the file.

Headings, descriptions, wording, blank lines, and the order of requirements all come back
exactly as they were. A requirement that has no block yet SHALL be given one, placed
after its description.

Why: the description is the human's half of the file. A tool that reflows someone's prose
while updating a list is a tool people stop letting run.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A generated block records where a scenario is, never what it claims

Each entry SHALL be a scenario's title and the file that proves it, and nothing more.

No GIVEN, WHEN or THEN. No line numbers. The Gherkin lives above its proof site, and a
second copy here is exactly the drift this tool exists to prevent. Line numbers move
whenever anyone edits a test, so storing one would manufacture a difference out of an
edit that changed nothing.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: Writing back twice changes nothing

Running the write-back on a file it has just written SHALL leave that file byte for byte
the same.

Entries come out in a fixed order, so the same tests give the same file on any machine.

Why: the guard compares what it regenerates against what is committed. If the writer and
the guard could ever disagree about the same input, a clean repo would fail its own build.

<!-- scenarios: generated -->
<!-- /scenarios -->
