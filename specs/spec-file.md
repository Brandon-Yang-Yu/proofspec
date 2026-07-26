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

Requirements come back in name order and entries in title order — the order the tree
uses, so what is read is already a branch of it. The file keeps its own order; that order
is the human's.

<!-- scenarios: generated -->
- "A heading inside a fenced code block is not a requirement" → tests/spec-file/read.test.ts
- "A line inside a generated block that is not an entry records no scenario" → tests/spec-file/read.test.ts
- "A requirement that records nothing reads as one with no entries" → tests/spec-file/read.test.ts
- "A requirement's description and its recorded entries are read together" → tests/spec-file/read.test.ts
- "Entries come back in title order, not the file's order" → tests/spec-file/read.test.ts
- "Requirements come back in name order, not the file's order" → tests/spec-file/read.test.ts
<!-- /scenarios -->

### Requirement: Writing back touches only the generated block

The write-back SHALL replace the content between `<!-- scenarios: generated -->` and
`<!-- /scenarios -->`, and change nothing else in the file.

Headings, descriptions, wording, blank lines, and the order of requirements all come back
exactly as they were. A requirement that has no block yet SHALL be given one, placed
after its description.

A marker inside a fenced code block is not a marker, for the same reason a heading inside
one is not a heading.

An opening marker whose closing one has been lost SHALL be written back closed. A block
the write-back could not recognise would be given a second one on every run, and a file
that grows each time it is written can never come to rest.

A requirement the file does not declare SHALL NOT be added. Its entries are left out, and
the guard reports them.

Why: the description is the human's half of the file. A tool that reflows someone's prose
while updating a list is a tool people stop letting run, and a tool that writes a heading
of its own is authoring the half it does not own.

<!-- scenarios: generated -->
- "A generated block inside a fenced code block is left alone" → tests/spec-file/write.test.ts
- "A requirement nothing proves any more is left with an empty block" → tests/spec-file/write.test.ts
- "A requirement with no block is given one after its description" → tests/spec-file/write.test.ts
- "An opening marker with no closing one is written back closed" → tests/spec-file/write.test.ts
- "Entries for a requirement the file does not declare are not written" → tests/spec-file/write.test.ts
- "Everything outside the generated blocks comes back unchanged" → tests/spec-file/write.test.ts
<!-- /scenarios -->

### Requirement: A generated block records where a scenario is, never what it claims

Each entry SHALL be a scenario's title and the file that proves it, and nothing more.

No GIVEN, WHEN or THEN. No line numbers. The Gherkin lives above its proof site, and a
second copy here is exactly the drift this tool exists to prevent. Line numbers move
whenever anyone edits a test, so storing one would manufacture a difference out of an
edit that changed nothing.

<!-- scenarios: generated -->
- "A title holding the entry separator survives being written and read back" → tests/spec-file/entry.test.ts
- "An entry is a title and a file on one line" → tests/spec-file/entry.test.ts
<!-- /scenarios -->

### Requirement: Writing back twice changes nothing

Running the write-back on a file it has just written SHALL leave that file byte for byte
the same.

Entries come out in title order whatever order they were handed over, so the same tests
give the same file on any machine.

Why: the guard compares what it regenerates against what is committed. If the writer and
the guard could ever disagree about the same input, a clean repo would fail its own build.

<!-- scenarios: generated -->
- "Entries come out in title order whatever order they were given" → tests/spec-file/idempotence.test.ts
- "Writing back a file that has just been written changes nothing" → tests/spec-file/idempotence.test.ts
<!-- /scenarios -->
