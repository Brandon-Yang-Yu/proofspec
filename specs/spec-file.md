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

Requirements come back in the order the file declares them. That order is the human's:
descriptions refer to their neighbours, so a requirement re-ordered on the way out turns
"the requirement below" into one written above it. Nothing downstream compares
requirements positionally, so the read owes them no order of its own.

Entries come back in title order — the order the tree holds them in, so what is read is
already a branch of it and reads the same on every machine.

<!-- scenarios: generated -->
- "A file that declares no requirements reads as a capability with none" → tests/spec-file/read.test.ts
- "A heading inside a fenced code block is not a requirement" → tests/spec-file/read.test.ts
- "A line inside a generated block that is not an entry records no scenario" → tests/spec-file/read.test.ts
- "A requirement that records nothing reads as one with no entries" → tests/spec-file/read.test.ts
- "A requirement's description and its recorded entries are read together" → tests/spec-file/read.test.ts
- "Entries come back in title order, not the file's order" → tests/spec-file/read.test.ts
- "Requirements come back in the file's own order" → tests/spec-file/read.test.ts
<!-- /scenarios -->

### Requirement: Reading a file yields its terms and what they define

Reading a capability file SHALL give back each `### Term:` heading and the definition
written beneath it. A Term section SHALL be no part of a requirement's description: a term
heading ends the prose above the block, wherever it is written, the way the next heading
always has.

A Term section ends where the next heading begins, whatever kind of heading that is — or
where a generated block opens, because a block records scenarios for the requirement the
section sits in, and is no more part of a definition than of a description. The fence rule
that governs requirement headings governs Term ones too: a file showing the format as an
example inside a code fence is saying what a term looks like, not defining one.

The write-back SHALL leave Term sections exactly as they were. A definition is the human's
half of the file, like a description; the tool that records where scenarios are has nothing
to write there.

<!-- scenarios: generated -->
- "A Term heading inside a fenced code block is not a term" → tests/spec-file/terms.test.ts
- "A Term heading reads as a term with the definition written under it" → tests/spec-file/terms.test.ts
- "A Term section is not part of a requirement's description" → tests/spec-file/terms.test.ts
- "Writing back leaves Term sections exactly as they were" → tests/spec-file/terms.test.ts
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
- "A file that declares no requirements comes back unchanged" → tests/spec-file/write.test.ts
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

### Requirement: Where each requirement is written is delivered on demand

Asked where a capability file's requirements are written, spec-file SHALL report the line
each `### Requirement:` heading sits on, read from the file as it stands.

Nothing outside spec-file knows the file is Markdown, so nothing else can find that line.
It is delivered, never stored — the same rule a scenario's position follows — and it obeys
the same fence rule reading does, so a heading shown as an example inside a code fence is
not reported as a place a requirement is written.

<!-- scenarios: generated -->
- "A heading shown inside a code fence is not a place a requirement is written" → tests/spec-file/lines.test.ts
- "A requirement's heading line is reported as it stands" → tests/spec-file/lines.test.ts
<!-- /scenarios -->
