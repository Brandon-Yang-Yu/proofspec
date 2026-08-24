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
- "Tests given by the caller are read as they stand" → tests/cli/locations.test.ts
- "The conventional layout is checked with no locations given" → tests/cli/locations.test.ts
<!-- /scenarios -->

### Requirement: Any answer can be given in a form a program can read

Every command SHALL be able to return its answer as JSON, carrying the same content as
the form written for a person.

The tree, the positions, and the failures are all things another tool will want — an
editor, a CI annotation, and in a later version an MCP server. Each of those should read
the same answer rather than parse the one meant for a terminal.

An answer SHALL reach its reader whole, however large it is. A pipe holds a fixed number of
bytes before its writer has to wait, and a process that ends without waiting hands the reader
an answer cut off mid-token: not a smaller answer, a broken one, and a parser reports it as a
syntax error rather than as anything the tool said. The command that reads that answer is
usually a program, and the layout below makes a large answer ordinary.

The JSON SHALL be given on one line unless a layout is asked for, and indented over several
lines when it is. One line is what a program parses and what a pipe carries. A person reads
the same answer too — the touched report especially, which is JSON without being asked — and
one line of it is the thing they reach for another tool to reformat. Laying it out is a
choice the caller makes, so the answer a script already reads does not change under it.

<!-- scenarios: generated -->
- "A format named on the command line is the one used" → tests/cli/touched.test.ts
- "A verdict still answers as text when no format is asked for" → tests/cli/touched.test.ts
- "An answer larger than a pipe holds reaches its reader whole" → tests/cli/e2e.test.ts
- "The JSON answer is laid out over indented lines when a person asks for it" → tests/cli/touched.test.ts
- "The JSON answer stays on one line when no layout is asked for" → tests/cli/touched.test.ts
- "The check's findings are returned as LSP diagnostics a modern editor shows inline" → tests/cli/format.test.ts
- "The check's findings are returned in quickfix form for an editor to jump to" → tests/cli/format.test.ts
- "The check's verdict is returned as JSON carrying the same findings" → tests/cli/json.test.ts
- "The touched command answers as JSON when no format is asked for" → tests/cli/touched.test.ts
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
demand and read by a person, never read back by the tool. The command writes an index, one
page per capability, and the full spec as a single page; given no directory it writes them
under `build/`, and a directory can be given for a repo that keeps the generated pages
elsewhere. The pages are a generated output, so a project gitignores that directory rather
than committing it. Inputs it cannot read are refused the way the check and the write refuse
them.

A capability's requirements are headed in the order its file declares them, not by name. A
description is prose the human owns, and prose refers to its neighbours: a page that sorts
the requirements makes every "the requirement below" point at one above it.

<!-- scenarios: generated -->
- "An absolute output directory is written to exactly" → tests/cli/render.test.ts
- "The render command reports it cannot run on unreadable inputs" → tests/cli/render.test.ts
- "The render command writes into a chosen directory" → tests/cli/render.test.ts
- "The render command writes to the default directory when none is given" → tests/cli/render.test.ts
- "The rendered page lists requirements in the capability file's order" → tests/cli/render.test.ts
<!-- /scenarios -->

### Requirement: A command says which scenarios a change touched

The CLI SHALL provide a command that reads the changes to the tests and says which promises
they reached, in one of three shapes: the work list, one requirement in full, or the changed
lines that fall in no proof. Asked for nothing in particular it SHALL give the work list.

Its report SHALL be given as JSON unless another format is named, and the format named SHALL
be the one used. This report is read by an agent far more often than by a person, and an
agent should not have to remember a flag to be answered in its own language. The default
follows the kind of answer rather than being one setting for the tool: a verdict still
answers as text, because what a person reads in the log of a build that just failed is a
verdict. A command that could not run answers the way every command reports being unable to
run, and a caller branches on the exit code rather than on the shape of that answer.

**The work list SHALL count each requirement the change reached rather than write it out**,
carrying its capability, its name, how many of its scenarios were touched, how many of its
proofs were removed, how many of those promises nobody has judged, and the address the rest of
it is fetched by. It also SHALL carry how many changed runs fall in no proof, as a number.

One shape used to carry everything at once, and the reason that stopped working is worth
writing down. Reviewing is per scenario, so it is a loop, and the work list is read on every
turn of it — carrying the claims and the proving source there charged the whole branch's worth
of context for the question "what is left". Measured on this tool's own branch the two shapes
are 716 bytes and 65 kilobytes. The saving is not in total: a reviewer who works through
everything reads all of it either way. It is that the reading is now bounded by one
requirement at a time, and that the answer to "what is left" gets cheaper as the work is done.

**One requirement asked for by address SHALL carry everything judging it takes**: the prose
written under it, every scenario of it the change touched with the claim it makes and the
lines that prove it as they are written, every proof of it the change removed, the key each of
those is judged under, whatever judgement already stands against each, and how they are to be
judged. Carrying the source is what makes one call enough — an agent asked whether a test still
does what its claim says would otherwise open every file the report named. A scenario proven
inside a shared test is proven by more than one run of lines, and the answer SHALL carry every
one of them, since handing over only the first would leave an agent judging a claim against
half its evidence. A sibling's lines are not among them.

Each requirement SHALL carry where it is written together with the prose written there. The
two arrive together or not at all: a requirement no capability file declares has neither, and
its scenarios are still named under it, because a promise nothing declares is exactly what the
reader has to see. Judging that gap is the check's job, not this one's.

An address that names no requirement the change reached SHALL be a cannot-run rather than an
empty answer. A stale key handed back as "nothing to judge here" is how a reviewer works
through a list and reviews none of it.

**The changed lines that fall in no proof SHALL be asked for on their own**, carrying their
source, and a run of them that is nothing but whitespace SHALL not be reported at all. They are
the helper, the import and the fixture edits, and they are usually a line or two — the read
that fetches them costs a reader more than the lines are worth, so they are carried as written.
But nothing judges them, and on a change that adds tests there are more of them than there are
promises, so they are not in the work list beyond their number. A blank line is worth nothing
either way: git hands one back with every block inserted beside it, and they would bury the
runs worth reading. The file they are in is often not a test, so it is read back for them; one
git names as changed but that cannot be read is a cannot-run, because reporting those lines as
blank is a claim about them and a wrong one.

Requirements SHALL come back in capability then requirement order, and the scenarios under
each in file order. Git lists what it already tracks ahead of what it has never seen, so the
order a diff arrives in is not an order at all; a report that is read again on the next run
has to be comparable with the last one.

The terminal form SHALL say the same things as the JSON one in each of the three shapes. A
person reading a work list wants the address to fetch by; one reading a requirement is walking
their diff, so its scenarios stay in file order there.

It compares against the branch point with `main` by default, so run inside a task's
worktree it answers "what did this branch touch"; `--since` names another revision. It
counts the work as it stands — the working tree and files not yet added to git, not only
what is committed — because in a worktree most of the work is uncommitted most of the time.

A change that removed a proof is read from the base revision and named too, so a promise
left with nothing behind it is reported rather than silently missing.

It reports what it found and does not judge it. Whatever the change touched — including a
promise nothing proves any more — that is not this command saying the build is wrong, and the
command that gives that verdict is the check. What it does hold a gate on is the reviewing,
which is the requirement below. A repo it cannot read — not a git repository, or a revision it
cannot resolve — SHALL exit the same cannot-run code the other commands use.

<!-- scenarios: generated -->
- "A change committed since the branch left main is counted" → tests/cli/touched.test.ts
- "A change inside a proof names the scenario and where its requirement is written" → tests/cli/touched.test.ts
- "A changed file that cannot be read back cannot run" → tests/cli/touched.test.ts
- "A changed run that is nothing but blank lines is not reported" → tests/cli/touched.test.ts
- "A directory that is not a git repository cannot run" → tests/cli/touched.test.ts
- "A key no touched requirement carries cannot run" → tests/cli/touched.test.ts
- "A proof the change removed is named from the base revision" → tests/cli/touched.test.ts
- "A requirement no capability file declares carries no prose" → tests/cli/touched.test.ts
- "A revision given on the command line replaces the branch point" → tests/cli/touched.test.ts
- "A scenario proven inside a shared test carries every run of lines that prove it" → tests/cli/touched.test.ts
- "A test file not yet added to git is counted" → tests/cli/touched.test.ts
- "A touched scenario carries the source of the lines that prove it" → tests/cli/touched.test.ts
- "One requirement holds every scenario of it the change touched" → tests/cli/touched.test.ts
- "Requirements come back in capability then requirement order" → tests/cli/touched.test.ts
- "The lines that prove nothing are counted in the work list and asked for on their own" → tests/cli/touched.test.ts
- "The requirement a touched scenario proves carries the prose written under it" → tests/cli/touched.test.ts
- "The terminal form of one requirement says how to record either verdict" → tests/cli/touched.test.ts
- "The terminal form of the lines that prove nothing carries them" → tests/cli/touched.test.ts
- "The touched command answers with one entry for each requirement it reached" → tests/cli/touched.test.ts
- "Touched scenarios come back in file order" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: The touched command holds the gate until every promise it reached has been judged

The work list SHALL exit non-zero while any promise the change reached has no review standing
against it, and zero when none is left. Asking for one requirement, or for the lines that prove
nothing, SHALL exit zero however much is unjudged.

This is what lets a hook hold the gate: a branch cannot be pushed with a promise on it nobody
has looked at. It is not the tool judging the change. It is the tool saying nobody has, which
is a fact about this branch's reviewing rather than about its code — and it is why the check
keeping its own non-zero code is no ambiguity. The two send a reader to different places: the
check to the spec, this to the review.

Only the work list SHALL hold it. Fetching one requirement is how a reviewer collects the work,
and an agent that read every fetch as a failed tool would stop partway through the very job the
gate exists to make it finish.

A promise SHALL count as judged whatever the judgement said. The gate asks whether every
promise was looked at, not whether every judgement was favourable. A reviewer who cannot report
a problem without blocking their own branch has a reason to write a pass instead, and what the
gate would then measure is their willingness to let themselves through.

<!-- scenarios: generated -->
- "A work list with a promise left unjudged exits non-zero" → tests/cli/touched.test.ts
- "A work list with every promise judged exits zero" → tests/cli/touched.test.ts
- "Asking for one requirement exits zero however much is unjudged" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: touched measures the tests a caller gives it

A caller SHALL be able to hand the command the tests it has already read, with the roots they
live under, in place of the conventional discovery. The diff SHALL then be scoped to those
roots, so a change to a given test is measured wherever it lives.

A repo whose tests sit outside `tests/` — several roots, another suffix — cannot be walked by
the one conventional discovery, but its promises are not worth less for that. The caller reads
its own tests its own way; this keeps the measuring — which promises the change reached, and
whether anybody has looked — one implementation. The roots are given with the files because the
diff needs a place to look: a test file the branch deleted is not among the files, and its
removal is only visible when the diff is scoped to where tests live.

<!-- scenarios: generated -->
- "A test deleted from a given root is read back as no longer proven" → tests/cli/touched.test.ts
- "Tests given with their root are scanned and diffed where they live" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: A command records a review of one touched scenario

The CLI SHALL provide a command that records one reviewer's judgement of one promise the change
reached, appending it to `.proofspec/reviews.jsonl`. A key naming no promise the change reached
SHALL be a cannot-run, and a review that `review` turns away SHALL be a cannot-run that writes
nothing.

A verdict the tool does not know SHALL be a cannot-run, refused before anything is written.
It is a decision about a value rather than about what the options can represent, so it is the
command's to make and not the argument parser's — which is also what puts it somewhere a test
can reach.

The promise is looked up rather than taken on trust because a pass has to be checked against
the lines it cites, and those lines are only in hand once the change has been read. A key
matching nothing is what a stale key looks like — the scenario moved out from under the
judgement — and filing it anyway would write a record nothing ever reads back.

The ledger is committed rather than ignored, unlike the coverage recording beside it. A page of
bare passes with nothing cited is visible in a pull request in a way no mechanical rule could
make it, and CI cannot hold a gate against a record that only ever existed on one machine.

<!-- scenarios: generated -->
- "A ledger that cannot be read cannot run" → tests/cli/review.test.ts
- "A pass citing a line outside the proof cannot run" → tests/cli/review.test.ts
- "A recorded review is appended to the ledger" → tests/cli/review.test.ts
- "A review of a promise the change did not reach cannot run" → tests/cli/review.test.ts
- "A reviewed scenario is no longer pending in the work list" → tests/cli/review.test.ts
- "A verdict the tool does not know cannot run" → tests/cli/review.test.ts
<!-- /scenarios -->

### Requirement: The requirement asked for carries how its scenarios are to be judged

One requirement asked for in full SHALL carry the question its scenarios are to be judged by,
along with what to run to record either answer.

The asking is not incidental. A reviewer asked "is this claim honest?" answers yes; one asked
to find where the claim promises more than the proof asserts goes looking. Only one of those
two questions finds anything, and which one gets asked cannot be left to whoever remembers to
ask it — the same argument that put the proving source in the payload rather than an address
to it.

<!-- scenarios: generated -->
- "The pass the protocol hands over is one the command line accepts" → tests/cli/review.test.ts
- "The requirement asked for carries how its scenarios are to be judged" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: A command walks from changed source to the tests that reach it

The CLI SHALL provide a command that takes the source this branch changed, walks the call
graph backwards from the functions those lines fall in, and reports the tests that reach
them along with the requirements those tests prove.

The call graph is not ProofSpec's to build. It is read from the codebase-memory index the
repository already keeps, or from a file when one is named — which is also how a test hands
one over, since a test cannot index a repository. Being unable to read a graph SHALL be a
cannot-run: "nothing reaches this change" and "I could not look" must not read the same.

Changed tests are `touched`'s question, so this command reads everything except them. Like
`touched` it only reports, and exits zero whatever it finds.

<!-- scenarios: generated -->
- "A change to the tests is not on this tree" → tests/cli/impact.test.ts
- "A changed file the graph knows no function in is reported unmapped" → tests/cli/impact.test.ts
- "A changed function's tree names the tests that reach it and what they prove" → tests/cli/impact.test.ts
- "A graph that cannot be read is a cannot-run" → tests/cli/impact.test.ts
- "Whatever it reaches, the command exits zero" → tests/cli/impact.test.ts
<!-- /scenarios -->

### Requirement: A test run narrows the tree to the scenarios that ran the change

Given what a test run recorded, the command SHALL name only the scenarios that ran the
changed functions, in place of every scenario their files hold.

The call graph reaches a test file, never a scenario inside it: one file's tests usually call
the same entry point, so without a run the honest answer is every promise that file proves. A
run says which of them executed the change, which is the answer a reviewer wanted. A recording
that cannot be read SHALL be a cannot-run rather than a silent fall back to the wide list —
asking for the exact answer and being given the wide one without being told is worse than
either.

<!-- scenarios: generated -->
- "A recording that cannot be read is a cannot-run" → tests/cli/impact.test.ts
- "Only the scenarios a run executed are named" → tests/cli/impact.test.ts
<!-- /scenarios -->
